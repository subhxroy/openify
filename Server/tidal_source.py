import base64
import json
import logging
import re
import time
import urllib.parse

import requests

logger = logging.getLogger("openify_server.tidal")

TIDAL_CLIENT_ID = "txNoH4kkV41MfH25"
TIDAL_CLIENT_SECRET = "dQjy0MinCEvxi1O4UmxvxWnDjt4cgHBPw8ll6nYBk98="
TIDAL_TOKEN_URL = "https://auth.tidal.com/v1/oauth2/token"
TIDAL_API_V1 = "https://api.tidal.com/v1"
TIDAL_OPENAPI = "https://openapi.tidal.com/v2"

_token_cache = {"access_token": None, "expires_at": 0}


def _get_token():
    if _token_cache["access_token"] and _token_cache["expires_at"] > time.time() + 60:
        return _token_cache["access_token"]
    try:
        resp = requests.post(
            TIDAL_TOKEN_URL,
            data={
                "client_id": TIDAL_CLIENT_ID,
                "client_secret": TIDAL_CLIENT_SECRET,
                "grant_type": "client_credentials",
                "scope": "r_usr+w_usr+w_sub",
            },
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=10,
        )
        if resp.status_code != 200:
            logger.warning(f"TIDAL token request failed: HTTP {resp.status_code}")
            return None
        data = resp.json()
        _token_cache["access_token"] = data["access_token"]
        _token_cache["expires_at"] = time.time() + data.get("expires_in", 3600) - 120
        logger.info("TIDAL OAuth2 token acquired")
        return _token_cache["access_token"]
    except Exception as e:
        logger.warning(f"TIDAL token acquisition failed: {e}")
        return None


def _api_headers():
    token = _get_token()
    if not token:
        return None
    return {
        "Authorization": f"Bearer {token}",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Content-Type": "application/json",
    }


def _clean_track_name(name):
    name = re.sub(r"\(feat\..*?\)", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\(ft\..*?\)", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\(official.*?\)", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\(audio\)", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\(video\)", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\(lyrics?\)", "", name, flags=re.IGNORECASE)
    name = re.sub(r"\[.*?\]", "", name)
    return name.strip()


def search_track(artist, title, limit=5):
    headers = _api_headers()
    if not headers:
        return None
    try:
        query = f"{artist} {title}"
        url = f"{TIDAL_OPENAPI}/searchResults/{urllib.parse.quote(query)}"
        params = {
            "include": "tracks",
            "countryCode": "US",
            "limit": limit,
        }
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        if resp.status_code != 200:
            logger.warning(f"TIDAL search failed: HTTP {resp.status_code}")
            return None
        data = resp.json()
        included = data.get("included", [])
        tracks_data = [item for item in included if item.get("type") == "tracks"]
        if not tracks_data:
            logger.info(f"TIDAL: no track results for '{query}'")
            return None
        cleaned_query_artist = _clean_track_name(artist).lower()
        cleaned_query_title = _clean_track_name(title).lower()
        best_match = None
        best_score = 0
        for t in tracks_data:
            attrs = t.get("attributes", {})
            track_title = _clean_track_name(attrs.get("title", "") or "").lower()
            track_artist = _clean_track_name(attrs.get("artist", "") or "").lower()
            score = 0
            if cleaned_query_title and cleaned_query_title == track_title:
                score += 50
            elif cleaned_query_title and (cleaned_query_title in track_title or track_title in cleaned_query_title):
                score += 25
            if cleaned_query_artist and cleaned_query_artist == track_artist:
                score += 50
            elif cleaned_query_artist and (cleaned_query_artist in track_artist or track_artist in cleaned_query_artist):
                score += 25
            if score > best_score:
                best_score = score
                best_match = t
        if not best_match:
            best_match = tracks_data[0]
        track_id = best_match.get("id")
        attrs = best_match.get("attributes", {})
        logger.info(f"TIDAL matched track id={track_id} â€” {attrs.get('title')} by {attrs.get('artist')} (score={best_score})")
        return {
            "id": track_id,
            "title": attrs.get("title", ""),
            "artist": attrs.get("artist", ""),
            "duration": attrs.get("duration", 0),
            "album": attrs.get("album", ""),
            "cover": attrs.get("cover", ""),
        }
    except Exception as e:
        logger.warning(f"TIDAL search failed for '{artist} - {title}': {e}")
        return None


def get_stream_url(track_id):
    headers = _api_headers()
    if not headers:
        return None
    try:
        url = f"{TIDAL_API_V1}/tracks/{track_id}/playbackinfo"
        params = {
            "audioquality": "HIGH",
            "playbackmode": "STREAM",
            "assetpresentation": "FULL",
            "countryCode": "US",
        }
        resp = requests.get(url, headers=headers, params=params, timeout=10)
        if resp.status_code != 200:
            logger.warning(f"TIDAL playbackinfo failed: HTTP {resp.status_code}")
            return None
        data = resp.json()
        manifest_b64 = data.get("manifest")
        if not manifest_b64:
            logger.warning("TIDAL: no manifest in playbackinfo response")
            return None
        try:
            manifest_json = json.loads(base64.b64decode(manifest_b64).decode("utf-8"))
        except Exception:
            logger.info("TIDAL manifest is not JSON (likely DASH MPD) â€” falling through")
            return None
        urls = manifest_json.get("urls", [])
        if not urls:
            logger.info("TIDAL manifest has no urls array â€” falling through")
            return None
        direct_url = urls[0]
        if not direct_url.startswith("http"):
            logger.warning(f"TIDAL manifest URL invalid: {direct_url[:60]}")
            return None
        logger.info(f"TIDAL stream URL acquired for track {track_id}")
        expire_at = data.get("expires", int(time.time()) + 3600)
        http_headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://tidal.com/",
        }
        return direct_url, http_headers, expire_at
    except Exception as e:
        logger.warning(f"TIDAL stream URL extraction failed for track {track_id}: {e}")
        return None
