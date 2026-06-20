import json
import logging
import os
import shutil
import sys
import time

# Refresh PATH from registry on Windows to pick up new installations (like winget Gyan.FFmpeg)
if sys.platform == "win32":
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
            user_path, _ = winreg.QueryValueEx(key, "Path")
            if user_path:
                user_path = os.path.expandvars(user_path)
                os.environ["PATH"] = user_path + os.pathsep + os.environ["PATH"]
    except Exception:
        pass

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from urllib.parse import quote

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("openify_server")


import requests
import yt_dlp
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, PlainTextResponse, StreamingResponse

from recommendation import (
    get_recommendations as get_song_recommendations,
    get_song_by_id,
    get_songs_by_ids,
    get_up_next,
    update_transition,
    upsert_song_records,
)





app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

import tempfile

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
CACHE_DIR = BASE_DIR / "song_cache"
CACHE_LIMIT_BYTES = 600 * 1024 * 1024

DATA_DIR.mkdir(parents=True, exist_ok=True)
CACHE_DIR.mkdir(parents=True, exist_ok=True)

# One-time purge of old audio cache files and stream URL cache to remove cover tracks
for entry in CACHE_DIR.iterdir():
    if entry.is_file():
        try:
            entry.unlink()
        except OSError:
            pass
try:
    (DATA_DIR / "stream_url_cache.json").unlink(missing_ok=True)
except OSError:
    pass

TEMP_COOKIE_FILE = None

def write_cookies_to_temp(cookie_content: str):
    global TEMP_COOKIE_FILE
    try:
        temp_dir = Path(tempfile.gettempdir())
        cookies_dest = temp_dir / "openify_cookies.txt"
        
        cookie_content_str = cookie_content.strip()
        is_json = False
        if cookie_content_str.startswith("[") and cookie_content_str.endswith("]"):
            try:
                cookies_json = json.loads(cookie_content_str)
                is_json = True
            except Exception:
                is_json = False
                
        if is_json:
            lines = ["# Netscape HTTP Cookie File\n", "# Generated from JSON by Openify\n\n"]
            for cookie in cookies_json:
                domain = cookie.get("domain", "")
                flag = "FALSE" if cookie.get("hostOnly", False) else "TRUE"
                if domain.startswith("."):
                    flag = "TRUE"
                path = cookie.get("path", "/")
                secure = "TRUE" if cookie.get("secure", False) else "FALSE"
                expiry = cookie.get("expirationDate")
                if expiry is None:
                    expiry = int(time.time()) + 31536000
                else:
                    expiry = int(expiry)
                name = cookie.get("name", "")
                value = cookie.get("value", "")
                lines.append(f"{domain}\t{flag}\t{path}\t{secure}\t{expiry}\t{name}\t{value}\n")
            netscape_content = "".join(lines)
        else:
            netscape_content = cookie_content
            
        cookies_dest.write_text(netscape_content, encoding="utf-8")
        TEMP_COOKIE_FILE = str(cookies_dest)
        logger.info(f"Successfully wrote cookies to temp location: {TEMP_COOKIE_FILE}")
        return True
    except Exception as e:
        logger.error(f"Failed to write cookies to temp location: {e}")
        return False

def initialize_cookies():
    # Load cookies in all environments (including production/Railway) to bypass bot checks.
    logger.info("Initializing cookies...")

    # 1. Try persistent data directory cookies.txt
    persistent_cookies_path = DATA_DIR / "cookies.txt"
    if persistent_cookies_path.exists():
        try:
            logger.info("Loading cookies from persistent data/cookies.txt")
            cookie_content = persistent_cookies_path.read_text(encoding="utf-8")
            if write_cookies_to_temp(cookie_content):
                return
        except Exception as e:
            logger.error(f"Failed to read persistent cookies: {e}")
            
    # 2. Try base directory cookies.txt
    cookies_source = BASE_DIR / "cookies.txt"
    if cookies_source.exists():
        try:
            logger.info("Loading cookies from Server/cookies.txt")
            cookie_content = cookies_source.read_text(encoding="utf-8")
            if write_cookies_to_temp(cookie_content):
                return
        except Exception as e:
            logger.error(f"Failed to read base directory cookies.txt: {e}")

    # 3. Try env var
    env_cookies = os.getenv("YOUTUBE_COOKIES")
    if env_cookies:
        logger.info("Loading cookies from YOUTUBE_COOKIES environment variable")
        if write_cookies_to_temp(env_cookies):
            return

initialize_cookies()

STREAM_URL_CACHE_PATH = DATA_DIR / "stream_url_cache.json"
STREAM_URL_CACHE = {}

def load_stream_url_cache():
    global STREAM_URL_CACHE
    if STREAM_URL_CACHE_PATH.exists():
        try:
            STREAM_URL_CACHE = json.loads(STREAM_URL_CACHE_PATH.read_text(encoding="utf-8"))
            logger.info(f"Loaded {len(STREAM_URL_CACHE)} entries from stream URL cache.")
        except Exception as e:
            logger.error(f"Failed to load stream URL cache: {e}")
            STREAM_URL_CACHE = {}

def save_stream_url_cache():
    try:
        STREAM_URL_CACHE_PATH.write_text(json.dumps(STREAM_URL_CACHE), encoding="utf-8")
    except Exception as e:
        logger.error(f"Failed to save stream URL cache: {e}")

load_stream_url_cache()

from urllib.parse import urlparse, parse_qs

def parse_url_expiry(url: str) -> int:
    try:
        parsed = urlparse(url)
        qs = parse_qs(parsed.query)
        expire_val = qs.get("expire")
        if expire_val:
            return int(expire_val[0])
    except Exception as e:
        logger.warning(f"Failed to parse url expiry: {e}")
    return int(time.time()) + 14400

import threading

executor = ThreadPoolExecutor(max_workers=2)
CURRENTLY_DOWNLOADING = set()
DOWNLOADING_LOCK = threading.Lock()


@app.middleware("http")
async def security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "SAMEORIGIN"
    response.headers["X-XSS-Protection"] = "1; mode=block"
    response.headers["Accept-Ranges"] = "bytes"
    return response


def is_song_cached(song_id):
    return (CACHE_DIR / f"{song_id}.m4a").exists()


def get_cache_size_bytes():
    return sum(entry.stat().st_size for entry in CACHE_DIR.iterdir() if entry.is_file())


def clear_audio_cache():
    for entry in CACHE_DIR.iterdir():
        if entry.is_file():
            try:
                entry.unlink()
            except OSError:
                pass


def clear_cache_if_needed():
    if get_cache_size_bytes() > CACHE_LIMIT_BYTES:
        clear_audio_cache()


def inject_cache_status(songs):
    for song in songs:
        song["cached"] = is_song_cached(song["id"])
    return songs


def _itunes_to_song(item):
    art_url = item.get("artworkUrl100", "")
    cover = art_url.replace("100x100bb", "200x200bb") if art_url else ""
    cover_xl = art_url.replace("100x100bb", "600x600bb") if art_url else ""
    return {
        "id": str(item.get("trackId", item.get("collectionId", 0))),
        "title": item.get("trackName", "Unknown"),
        "artist": item.get("artistName", "Unknown"),
        "artist_id": item.get("artistId", 0),
        "album": item.get("collectionName", "Single"),
        "cover": cover,
        "cover_xl": cover_xl,
        "duration": item.get("trackTimeMillis", 0) // 1000,
        "genre": item.get("primaryGenreName", "Music"),
    }


def search_local_catalog(query):
    import difflib
    from recommendation.content import _read_catalog
    
    query_clean = query.strip().lower()
    if not query_clean:
        return []
    
    catalog = _read_catalog()
    results = []
    
    query_words = query_clean.split()
    
    for song in catalog:
        title = (song.get("title") or "").lower()
        artist = (song.get("artist") or "").lower()
        album = (song.get("album") or "").lower()
        
        matched = False
        score = 0.0
        
        if query_clean in title or query_clean in artist or query_clean in album:
            score = 1.0
            matched = True
        else:
            word_matches = 0
            for word in query_words:
                if word in title or word in artist or word in album:
                    word_matches += 1
            
            if len(query_words) > 0 and word_matches == len(query_words):
                score = 0.95
                matched = True
            elif len(query_words) > 1 and word_matches >= len(query_words) - 1:
                score = 0.8
                matched = True
            else:
                title_ratio = difflib.SequenceMatcher(None, query_clean, title).ratio()
                artist_ratio = difflib.SequenceMatcher(None, query_clean, artist).ratio()
                ratio = max(title_ratio, artist_ratio)
                if ratio > 0.55:
                    score = ratio * 0.75
                    matched = True
        
        if matched:
            results.append((song, score))
            
    results.sort(key=lambda x: -x[1])
    return [r[0] for r in results[:25]]


def search_songs(query):
    if not query:
        return []
    try:
        response = requests.get(
            "https://itunes.apple.com/search",
            params={"term": query, "media": "music", "limit": 25, "country": "IN"},
            timeout=10,
        )
        data = response.json()
        songs = [_itunes_to_song(item) for item in data.get("results", []) if item.get("trackName")]
        upsert_song_records(songs)
        
        # Merge with local catalog search for fuzzy matches
        try:
            local_results = search_local_catalog(query)
            seen_ids = {song["id"] for song in songs}
            for song in local_results:
                if song["id"] not in seen_ids:
                    songs.append(song)
                    seen_ids.add(song["id"])
        except Exception as local_err:
            logger.warning("Local fuzzy search failed: %s", local_err)
            
        return inject_cache_status(songs[:25])
    except Exception as e:
        logger.exception("Search songs error for query: %s", query)
        try:
            local_results = search_local_catalog(query)
            return inject_cache_status(local_results)
        except Exception:
            return []


def get_chart():
    try:
        response = requests.get("https://itunes.apple.com/in/rss/topsongs/limit=25/json", timeout=10).json()
        entries = response.get("feed", {}).get("entry", [])
        songs = []
        for entry in entries:
            try:
                art_url = ""
                for img in entry.get("im:image", []):
                    art_url = img.get("label", "")
                cover = art_url.replace("170x170bb", "200x200bb") if art_url else ""
                cover_xl = art_url.replace("170x170bb", "600x600bb") if art_url else ""
                artist_id = 0
                artist_link = entry.get("im:artist", {}).get("attributes", {}).get("href", "")
                if "/id" in artist_link:
                    try:
                        artist_id = int(artist_link.split("/id")[-1].split("?")[0])
                    except Exception as e:
                        logger.warning("Failed to parse artist ID: %s", e)
                track_id = str(entry.get("id", {}).get("attributes", {}).get("im:id", "0") or "0")
                genre = entry.get("category", {}).get("attributes", {}).get("label", "Music")
                songs.append(
                    {
                        "id": track_id,
                        "title": entry.get("im:name", {}).get("label", "Unknown"),
                        "artist": entry.get("im:artist", {}).get("label", "Unknown"),
                        "artist_id": artist_id,
                        "album": entry.get("im:collection", {}).get("im:name", {}).get("label", "Single"),
                        "cover": cover,
                        "cover_xl": cover_xl,
                        "duration": 0,
                        "genre": genre,
                    }
                )
            except Exception as e:
                logger.warning("Failed to parse entry: %s", e)
                continue
        upsert_song_records(songs)
        return inject_cache_status(songs)
    except Exception as e:
        logger.exception("Get chart error")
        return []



# ─────────────────────────────────────────────────────────────────────────────
# JioSaavn — Primary cookie-free audio source (no auth needed, works globally)
# ─────────────────────────────────────────────────────────────────────────────

def _decrypt_jiosaavn_url(encrypted_url: str) -> str:
    """Decrypt JioSaavn's DES-encrypted media URL."""
    try:
        from Crypto.Cipher import DES
        import base64

        key = b"38346591"
        enc = base64.b64decode(encrypted_url.strip())
        cipher = DES.new(key, DES.MODE_ECB)
        decrypted = cipher.decrypt(enc)
        # Remove padding and fix URL quality
        url = decrypted.decode("utf-8", errors="ignore").rstrip("\x00\x01\x02\x03\x04\x05\x06\x07\x08\t")
        # Upgrade to 320kbps if available
        url = url.replace("_96.mp4", "_320.mp4").replace("_160.mp4", "_320.mp4")
        return url.strip()
    except Exception as e:
        logger.warning(f"JioSaavn URL decryption failed: {e}")
        return ""


def get_audio_stream_via_jiosaavn(artist: str, title: str, expected_duration: int | None = None):
    """
    Fetch a direct audio stream URL from JioSaavn's unofficial API.
    Uses duration and metadata matching to find the best matching studio track.
    Returns (direct_url, headers, expire_at) or None.
    """
    try:
        query = f"{artist} {title}"
        # Search JioSaavn — encrypted_media_url is already in search results
        search_resp = requests.get(
            "https://www.jiosaavn.com/api.php",
            params={
                "__call": "search.getResults",
                "q": query,
                "_format": "json",
                "_marker": "0",
                "api_version": "4",
                "ctx": "web6dot0",
                "p": "1",
                "n": "5",
            },
            headers={
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "Referer": "https://www.jiosaavn.com",
            },
            timeout=8,
        )
        if search_resp.status_code != 200:
            logger.warning(f"JioSaavn search returned HTTP {search_resp.status_code}")
            return None

        search_data = search_resp.json()
        results = search_data.get("results", [])
        if not results:
            logger.warning(f"JioSaavn: no results for '{query}'")
            return None

        best_song = None
        best_score = -999.0

        for song in results:
            more_info = song.get("more_info", {})
            enc_url = more_info.get("encrypted_media_url", "")
            if not enc_url:
                continue

            # Calculate match score
            score = 100.0

            # 1. Compare duration if expected
            if expected_duration is not None and expected_duration > 0:
                try:
                    song_duration = int(more_info.get("duration", 0))
                    duration_diff = abs(song_duration - expected_duration)
                    if duration_diff > 12:
                        score -= min(duration_diff * 2.5, 60)  # Penalize duration differences
                except Exception:
                    pass

            # 2. Check title matching (penalize remixes/covers/live if not in query)
            song_title = (song.get("title", "") or "").lower()
            query_lower = query.lower()
            
            for word in ["remix", "live", "cover", "karaoke", "instrumental", "tribute", "mashup"]:
                if word in song_title and word not in query_lower:
                    score -= 40

            # 3. Check primary artist map
            artist_matched = False
            primary_artists = more_info.get("artistMap", {}).get("primary_artists", [])
            for art in primary_artists:
                art_name = (art.get("name", "") or "").lower()
                if art_name in query_lower or any(part in query_lower for part in art_name.split()):
                    artist_matched = True
                    break
            
            if not artist_matched and primary_artists:
                score -= 15

            if score > best_score:
                best_score = score
                best_song = song

        if not best_song:
            logger.warning(f"JioSaavn: no suitable match found for '{query}'")
            return None

        # Bypass JioSaavn for international/English tracks (to avoid covers/tributes)
        song_language = (best_song.get("language", "") or "").lower()
        indian_languages = {
            "hindi", "punjabi", "tamil", "telugu", "bengali", "marathi", 
            "kannada", "malayalam", "gujarati", "rajasthani", "bhojpuri", 
            "odia", "urdu", "assamese", "haryanvi"
        }
        if song_language and song_language not in indian_languages:
            logger.info(f"Skipping JioSaavn for international song '{query}' (language: {song_language})")
            return None

        more_info = best_song.get("more_info", {})
        encrypted_url = more_info.get("encrypted_media_url", "")

        # Decrypt the URL
        direct_url = _decrypt_jiosaavn_url(encrypted_url)
        if not direct_url or not direct_url.startswith("http"):
            logger.warning(f"JioSaavn: decryption yielded invalid URL: '{direct_url[:80]}'")
            return None

        logger.info(f"JioSaavn audio stream for '{query}' (best score={best_score}): {direct_url[:80]}")
        http_headers = {
            "User-Agent": "Mozilla/5.0",
            "Referer": "https://www.jiosaavn.com",
        }
        expire_at = int(time.time()) + 3 * 3600  # JioSaavn URLs valid ~3h
        return direct_url, http_headers, expire_at

    except Exception as e:
        logger.warning(f"JioSaavn stream fetch failed for '{artist} - {title}': {e}")
        return None


def fetch_lyrics(artist, title):

    """
    Fetch lyrics with multiple fallback sources for reliability:
    1. lrclib.net (preferred — synced LRC lyrics)
    2. lyrics.ovh (plain text fallback)
    3. chartlyrics.com (plain text last resort)
    """
    # --- Source 1: lrclib.net (synced + plain) ---
    try:
        resp = requests.get(
            "https://lrclib.net/api/search",
            params={"artist_name": artist, "track_name": title},
            headers={"User-Agent": "Openify/1.0"},
            timeout=6,
        )
        data = resp.json()
        if isinstance(data, list) and data:
            for item in data:
                if item.get("syncedLyrics"):
                    logger.info("Lyrics found on lrclib.net (synced) for %s - %s", artist, title)
                    return {"type": "synced", "text": item["syncedLyrics"]}
            for item in data:
                if item.get("plainLyrics"):
                    logger.info("Lyrics found on lrclib.net (plain) for %s - %s", artist, title)
                    return {"type": "plain", "text": item["plainLyrics"]}
    except Exception as e:
        logger.warning("lrclib.net failed for %s - %s: %s", artist, title, e)

    # --- Source 2: lyrics.ovh ---
    try:
        from urllib.parse import quote as urlquote
        resp2 = requests.get(
            f"https://api.lyrics.ovh/v1/{urlquote(artist)}/{urlquote(title)}",
            timeout=6,
        )
        if resp2.status_code == 200:
            data2 = resp2.json()
            lyrics_text = data2.get("lyrics", "").strip()
            if lyrics_text:
                logger.info("Lyrics found on lyrics.ovh for %s - %s", artist, title)
                return {"type": "plain", "text": lyrics_text}
    except Exception as e:
        logger.warning("lyrics.ovh failed for %s - %s: %s", artist, title, e)

    # --- Source 3: chartlyrics.com ---
    try:
        import xml.etree.ElementTree as ET
        from urllib.parse import quote as urlquote
        resp3 = requests.get(
            "http://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect",
            params={"artist": artist, "song": title},
            timeout=6,
        )
        if resp3.status_code == 200:
            root = ET.fromstring(resp3.text)
            ns = {"cl": "http://api.chartlyrics.com/"}
            lyric_el = root.find(".//cl:Lyric", ns)
            if lyric_el is not None and lyric_el.text and lyric_el.text.strip():
                logger.info("Lyrics found on chartlyrics.com for %s - %s", artist, title)
                return {"type": "plain", "text": lyric_el.text.strip()}
    except Exception as e:
        logger.warning("chartlyrics.com failed for %s - %s: %s", artist, title, e)

    logger.info("No lyrics found from any source for %s - %s", artist, title)
    return {"type": "error", "text": "No lyrics found."}


def fetch_artist_tracks(artist_id, limit=20):
    try:
        artist_id = int(artist_id or 0)
        if artist_id <= 0:
            return []
        response = requests.get(
            "https://itunes.apple.com/lookup",
            params={"id": artist_id, "entity": "song", "limit": limit, "country": "IN"},
            timeout=10,
        )
        data = response.json()
        songs = [_itunes_to_song(item) for item in data.get("results", []) if item.get("wrapperType") == "track" and item.get("trackName")]
        if songs:
            upsert_song_records(songs)
        return songs
    except Exception as e:
        logger.exception("Fetch artist tracks error for artist_id: %s", artist_id)
        return []


def fetch_artist_search_results(artist_name, limit=25):
    try:
        artist_name = (artist_name or "").strip()
        if not artist_name:
            return []
        response = requests.get(
            "https://itunes.apple.com/search",
            params={"term": artist_name, "media": "music", "entity": "song", "limit": limit, "country": "IN"},
            timeout=10,
        )
        data = response.json()
        songs = []
        normalized_artist = artist_name.casefold()
        for item in data.get("results", []):
            item_artist = str(item.get("artistName", "")).strip()
            if not item.get("trackName"):
                continue
            if normalized_artist not in item_artist.casefold() and item_artist.casefold() not in normalized_artist:
                continue
            songs.append(_itunes_to_song(item))
        if songs:
            upsert_song_records(songs)
        return songs
    except Exception as e:
        logger.exception("Fetch artist search results error for artist: %s", artist_name)
        return []


def lookup_song_on_itunes(song_id):
    try:
        response = requests.get(
            "https://itunes.apple.com/lookup",
            params={"id": song_id, "country": "IN"},
            timeout=10,
        )
        data = response.json()
        results = data.get("results", [])
        if results:
            song = _itunes_to_song(results[0])
            upsert_song_records([song])
            return song
    except Exception as e:
        logger.warning(f"Failed to lookup song {song_id} on iTunes: {e}")
    return None


def enrich_catalog_for_song(song_id):
    song = get_song_by_id(song_id)
    if not song:
        song = lookup_song_on_itunes(song_id)
    if not song:
        return
    fetched_songs = fetch_artist_tracks(song.get("artist_id"))
    if not fetched_songs:
        fetch_artist_search_results(song.get("artist"))


def hydrate_song_ids(song_ids):
    return inject_cache_status(get_songs_by_ids(song_ids))


def build_recommendation_response(song_id):
    enrich_catalog_for_song(song_id)
    grouped_ids = get_song_recommendations(song_id)
    return {
        "behavior_based": hydrate_song_ids(grouped_ids.get("behavior_based", [])),
        "content_based": hydrate_song_ids(grouped_ids.get("content_based", [])),
    }


def build_up_next_response(song_id, limit=10):
    enrich_catalog_for_song(song_id)
    entries = get_up_next(song_id, limit=limit)
    songs_by_id = {song["id"]: song for song in hydrate_song_ids([entry["song_id"] for entry in entries])}
    result = []
    for entry in entries:
        song = songs_by_id.get(entry["song_id"])
        if song:
            item = dict(song)
            item["reason"] = entry["reason"]
            result.append(item)
    return result


def download_task(song_id, artist, title):
    with DOWNLOADING_LOCK:
        if song_id in CURRENTLY_DOWNLOADING:
            logger.info(f"Song {song_id} is already downloading, skipping duplicate task")
            return
        CURRENTLY_DOWNLOADING.add(song_id)

    try:
        clear_cache_if_needed()
        filepath = CACHE_DIR / f"{song_id}.m4a"
        if filepath.exists():
            return
        query = f"{artist} - {title} audio"

        # 1. Try JioSaavn first (no cookies, no auth needed)
        expected_duration = None
        song_info = get_song_by_id(song_id)
        if song_info:
            expected_duration = song_info.get("duration")
        saavn_result = get_audio_stream_via_jiosaavn(artist, title, expected_duration=expected_duration)
        if saavn_result:
            direct_url, saavn_headers, _ = saavn_result
            try:
                logger.info(f"Downloading song {song_id} from JioSaavn")
                resp = requests.get(direct_url, stream=True, headers=saavn_headers, timeout=60)
                if resp.status_code == 200:
                    with open(filepath, "wb") as f:
                        for chunk in resp.iter_content(chunk_size=1024 * 64):
                            if chunk:
                                f.write(chunk)
                    clear_cache_if_needed()
                    logger.info(f"Successfully downloaded song {song_id} via JioSaavn")
                    return
            except Exception as dl_exc:
                logger.warning(f"JioSaavn download failed for {song_id}: {dl_exc}")
                if filepath.exists():
                    filepath.unlink(missing_ok=True)

        # 2. Resolve YouTube video ID
        video_id = search_youtube_via_invidious(query)
        if not video_id:
            video_id = search_youtube_via_piped(query)
        if not video_id:
            video_id = search_youtube_via_ytdlp(query)
        if not video_id:
            logger.warning(f"Could not resolve video_id for download: {artist} - {title}")
            return

        # 3. Try Piped/Invidious stream for download (no yt-dlp, no cookies)
        piped_result = get_audio_stream_via_piped(video_id)
        if not piped_result:
            piped_result = get_audio_stream_via_invidious(video_id)

        if piped_result:
            direct_url, _, _ = piped_result
            try:
                logger.info(f"Downloading cached audio from Piped/Invidious for song {song_id}")
                resp = requests.get(direct_url, stream=True, headers={"User-Agent": "Mozilla/5.0"}, timeout=60)
                if resp.status_code == 200:
                    with open(filepath, "wb") as f:
                        for chunk in resp.iter_content(chunk_size=1024 * 64):
                            if chunk:
                                f.write(chunk)
                    clear_cache_if_needed()
                    logger.info(f"Successfully downloaded song {song_id} via Piped/Invidious")
                    return
            except Exception as dl_exc:
                logger.warning(f"Piped/Invidious download failed for {song_id}: {dl_exc}")
                # Clean up partial file
                if filepath.exists():
                    filepath.unlink(missing_ok=True)

        # Fallback: yt-dlp download
        target = f"https://www.youtube.com/watch?v={video_id}"
        logger.info(f"Downloading via yt-dlp for target: {target} (query: {query})")
        ydl_opts = {
            "format": "bestaudio[ext=m4a]/bestaudio/best",
            "outtmpl": str(filepath),
            "noplaylist": True,
            "quiet": True,
            "extractor_args": {"youtube": {"client": ["android", "ios"]}},
        }
        proxy_env = os.getenv("YOUTUBE_PROXY")
        if proxy_env:
            ydl_opts["proxy"] = proxy_env
        if TEMP_COOKIE_FILE:
            ydl_opts["cookiefile"] = TEMP_COOKIE_FILE

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([target])
        except Exception as download_exc:
            logger.warning(f"yt-dlp download failed: {download_exc}. Trying without cookies...")
            ydl_opts_fallback = dict(ydl_opts)
            ydl_opts_fallback.pop("cookiefile", None)
            with yt_dlp.YoutubeDL(ydl_opts_fallback) as ydl:
                ydl.download([target])

        clear_cache_if_needed()
        logger.info(f"Successfully downloaded and cached song {song_id} via yt-dlp")
    except Exception as e:
        logger.exception("Download task exception for song: %s (%s - %s)", song_id, artist, title)
    finally:
        with DOWNLOADING_LOCK:
            CURRENTLY_DOWNLOADING.discard(song_id)


# ─────────────────────────────────────────────────────────────────────────────
# Cookie-free audio stream extraction via Piped / Invidious
# These services solve YouTube's bot-detection on their own servers,
# so we can get direct Googlevideo CDN URLs without any cookies.
# ─────────────────────────────────────────────────────────────────────────────

PIPED_API_INSTANCES = [
    "https://pipedapi.kavin.rocks",
    "https://piped-api.garudalinux.org",
    "https://pipedapi.tokhmi.xyz",
    "https://watchapi.whatever.social",
    "https://api.piped.privacydev.net",
    "https://piped.video/api",
    "https://api.piped.yt",
    "https://pipedapi.reallyawesomelink.co",
]

INVIDIOUS_STREAM_INSTANCES = [
    "https://invidious.projectsegfaut.im",
    "https://yewtu.be",
    "https://invidious.privacydev.net",
    "https://inv.nadeko.net",
    "https://iv.ggtyler.dev",
    "https://invidious.lunar.icu",
]


def get_audio_stream_via_piped(video_id: str):
    """
    Fetch a direct audio stream URL from a Piped instance — no yt-dlp, no cookies.
    Piped solves YouTube's n-challenge on its own servers.
    Returns (direct_url, headers, expire_at) or None.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def try_instance(base):
        try:
            resp = requests.get(
                f"{base}/streams/{video_id}",
                timeout=8,
                headers={"User-Agent": "Mozilla/5.0"}
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            if data.get("error"):
                return None
            audio_streams = data.get("audioStreams", [])
            if not audio_streams:
                return None
            # Prefer m4a/mp4a for broadest compatibility
            m4a = [s for s in audio_streams if "m4a" in s.get("mimeType", "") or "mp4a" in s.get("mimeType", "")]
            candidates = m4a if m4a else audio_streams
            best = max(candidates, key=lambda s: s.get("bitrate", 0))
            url = best.get("url", "")
            if not url:
                return None
            logger.info(f"Piped {base} → audio stream for {video_id} (bitrate={best.get('bitrate','?')}bps)")
            return url
        except Exception as e:
            logger.warning(f"Piped {base} failed for {video_id}: {e}")
            return None

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(try_instance, base): base for base in PIPED_API_INSTANCES}
            for future in as_completed(futures, timeout=10):
                result = future.result()
                if result:
                    http_headers = {"User-Agent": "Mozilla/5.0"}
                    expire_at = parse_url_expiry(result) if result else int(time.time()) + 14400
                    return result, http_headers, expire_at
    except Exception as e:
        logger.warning(f"Piped parallel stream extraction failed for {video_id}: {e}")
    return None


def get_audio_stream_via_invidious(video_id: str):
    """
    Fetch a direct audio stream URL from an Invidious instance — no yt-dlp, no cookies.
    Returns (direct_url, headers, expire_at) or None.
    """
    from concurrent.futures import ThreadPoolExecutor, as_completed

    def try_instance(base):
        try:
            resp = requests.get(
                f"{base}/api/v1/videos/{video_id}",
                params={"fields": "adaptiveFormats"},
                timeout=8,
                headers={"User-Agent": "Mozilla/5.0"}
            )
            if resp.status_code != 200:
                return None
            data = resp.json()
            formats = data.get("adaptiveFormats", [])
            # Find best audio-only m4a/mp4 format
            audio_formats = [
                f for f in formats
                if f.get("type", "").startswith("audio") and not f.get("qualityLabel")
            ]
            m4a_formats = [
                f for f in audio_formats
                if "m4a" in f.get("container", "") or "mp4" in f.get("container", "")
            ]
            candidates = m4a_formats if m4a_formats else audio_formats
            if not candidates:
                return None
            best = max(candidates, key=lambda f: f.get("bitrate", 0))
            url = best.get("url", "")
            if not url:
                return None
            logger.info(f"Invidious {base} → audio stream for {video_id}")
            return url
        except Exception as e:
            logger.warning(f"Invidious {base} failed for {video_id}: {e}")
            return None

    try:
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(try_instance, base): base for base in INVIDIOUS_STREAM_INSTANCES}
            for future in as_completed(futures, timeout=10):
                result = future.result()
                if result:
                    http_headers = {"User-Agent": "Mozilla/5.0"}
                    expire_at = parse_url_expiry(result) if result else int(time.time()) + 14400
                    return result, http_headers, expire_at
    except Exception as e:
        logger.warning(f"Invidious parallel stream extraction failed for {video_id}: {e}")
    return None


def build_proxy_response(url: str, incoming_headers, headers_json: str):
    try:
        try:
            yt_headers = json.loads(headers_json or "{}")
        except Exception as e:
            logger.warning("Failed to parse headers JSON: %s", e)
            yt_headers = {}

        headers = {
            "User-Agent": yt_headers.get("User-Agent", "Mozilla/5.0"),
            "Accept": yt_headers.get("Accept", "*/*"),
            "Accept-Language": yt_headers.get("Accept-Language", "en-us,en;q=0.5"),
            "Sec-Fetch-Mode": yt_headers.get("Sec-Fetch-Mode", "navigate"),
        }
        if "range" in incoming_headers:
            headers["Range"] = incoming_headers["range"]

        req = requests.get(url, stream=True, headers=headers, timeout=30)
        excluded_headers = {
            "content-encoding", "transfer-encoding", "connection", 
            "date", "server", "access-control-allow-origin", 
            "access-control-allow-methods", "access-control-allow-headers", 
            "access-control-expose-headers"
        }
        response_headers = {name: value for name, value in req.headers.items() if name.lower() not in excluded_headers}
        response_headers["Accept-Ranges"] = "bytes"
        return StreamingResponse(
            req.iter_content(chunk_size=1024 * 16),
            status_code=req.status_code,
            media_type=req.headers.get("content-type", "audio/mp4"),
            headers=response_headers,
        )
    except Exception as exc:
        logger.exception("Proxy stream error for URL %s", url)
        return PlainTextResponse(f"Stream error: {exc}", status_code=500)


def get_base_url(request: Request) -> str:
    scheme = request.headers.get("x-forwarded-proto", request.url.scheme)
    return f"{scheme}://{request.url.netloc}"


def render_play_response(request: Request, song_id: str, artist: str, title: str):
    filename = f"{song_id}.m4a"
    filepath = CACHE_DIR / filename
    
    # 1. Check disk cache
    if filepath.exists():
        base_url = get_base_url(request)
        return JSONResponse({"source": "local", "url": f"{base_url}/api/mobile/stream_cache/{filename}"})

    # 2. Check stream URL cache
    now = int(time.time())
    cached_entry = STREAM_URL_CACHE.get(song_id)
    if cached_entry and cached_entry.get("expire_at", 0) > now + 60:
        logger.info(f"Serving song {song_id} from stream URL cache")
        base_url = get_base_url(request)
        direct_url = cached_entry["direct_url"]
        http_headers = cached_entry["headers"]
        proxy_url = f"{base_url}/api/mobile/stream_proxy?url={quote(direct_url)}&headers={quote(json.dumps(http_headers))}"
        
        # Trigger background auto-download to disk cache
        executor.submit(download_task, song_id, artist, title)
        
        return JSONResponse({
            "source": "youtube_cached", 
            "url": proxy_url, 
            "direct_url": direct_url, 
            "headers": http_headers
        })

    # 3. Try JioSaavn first (no cookies, no auth, works everywhere globally)
    base_url = get_base_url(request)
    expected_duration = None
    song_info = get_song_by_id(song_id)
    if not song_info:
        song_info = lookup_song_on_itunes(song_id)
    if song_info:
        expected_duration = song_info.get("duration")

    saavn_result = get_audio_stream_via_jiosaavn(artist, title, expected_duration=expected_duration)
    if saavn_result:
        direct_url, http_headers, expire_at = saavn_result
        STREAM_URL_CACHE[song_id] = {"direct_url": direct_url, "headers": http_headers, "expire_at": expire_at}
        save_stream_url_cache()
        proxy_url = f"{base_url}/api/mobile/stream_proxy?url={quote(direct_url)}&headers={quote(json.dumps(http_headers))}"
        executor.submit(download_task, song_id, artist, title)
        return JSONResponse({"source": "jiosaavn", "url": proxy_url, "direct_url": direct_url, "headers": http_headers})

    # 4. Resolve YouTube video ID via unblocked search helpers
    query = f"{artist} - {title} audio"
    video_id = search_youtube_via_invidious(query)
    if not video_id:
        video_id = search_youtube_via_piped(query)
    if not video_id:
        video_id = search_youtube_via_ytdlp(query)

    if not video_id:
        return JSONResponse({"error": "Could not find song on YouTube"}, status_code=404)

    logger.info(f"Resolved video_id={video_id} for query: {query}")

    # ── 5. Cookie-free extraction: try Piped ────────────────────────────────
    piped_result = get_audio_stream_via_piped(video_id)
    if piped_result:
        direct_url, http_headers, expire_at = piped_result
        STREAM_URL_CACHE[song_id] = {"direct_url": direct_url, "headers": http_headers, "expire_at": expire_at}
        save_stream_url_cache()
        proxy_url = f"{base_url}/api/mobile/stream_proxy?url={quote(direct_url)}&headers={quote(json.dumps(http_headers))}"
        executor.submit(download_task, song_id, artist, title)
        return JSONResponse({"source": "piped", "url": proxy_url, "direct_url": direct_url, "headers": http_headers})

    # ── 6. Cookie-free extraction: try Invidious ────────────────────────────
    inv_result = get_audio_stream_via_invidious(video_id)
    if inv_result:
        direct_url, http_headers, expire_at = inv_result
        STREAM_URL_CACHE[song_id] = {"direct_url": direct_url, "headers": http_headers, "expire_at": expire_at}
        save_stream_url_cache()
        proxy_url = f"{base_url}/api/mobile/stream_proxy?url={quote(direct_url)}&headers={quote(json.dumps(http_headers))}"
        executor.submit(download_task, song_id, artist, title)
        return JSONResponse({"source": "invidious", "url": proxy_url, "direct_url": direct_url, "headers": http_headers})

    # ── 6. Last resort: yt-dlp (with and without cookies) ───────────────────
    target = f"https://www.youtube.com/watch?v={video_id}"
    logger.info(f"Falling back to yt-dlp for target: {target}")
    ydl_opts = {
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "noplaylist": True,
        "quiet": True,
        "extractor_args": {"youtube": {"client": ["android", "ios"]}},
    }
    proxy_env = os.getenv("YOUTUBE_PROXY")
    if proxy_env:
        ydl_opts["proxy"] = proxy_env
    if TEMP_COOKIE_FILE:
        ydl_opts["cookiefile"] = TEMP_COOKIE_FILE

    extracted_info = None
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            extracted_info = ydl.extract_info(target, download=False)
    except Exception as exc:
        logger.warning(f"yt-dlp extraction failed (with cookies): {exc}. Trying without cookies...")
        ydl_opts_fallback = dict(ydl_opts)
        ydl_opts_fallback.pop("cookiefile", None)
        try:
            with yt_dlp.YoutubeDL(ydl_opts_fallback) as ydl:
                extracted_info = ydl.extract_info(target, download=False)
        except Exception as fallback_exc:
            logger.exception("yt-dlp fallback also failed for target: %s", target)
            return JSONResponse({"error": f"Song not found: {fallback_exc}"}, status_code=404)

    if extracted_info:
        try:
            video = extracted_info["entries"][0] if "entries" in extracted_info else extracted_info
            direct_url = video["url"]
            http_headers = video.get("http_headers", {})
            expire_at = parse_url_expiry(direct_url)
            STREAM_URL_CACHE[song_id] = {"direct_url": direct_url, "headers": http_headers, "expire_at": expire_at}
            save_stream_url_cache()
            logger.info(f"Cached stream URL for song {song_id} via yt-dlp, expiring at {expire_at}")
            proxy_url = f"{base_url}/api/mobile/stream_proxy?url={quote(direct_url)}&headers={quote(json.dumps(http_headers))}"
            executor.submit(download_task, song_id, artist, title)
            return JSONResponse({"source": "youtube", "url": proxy_url, "direct_url": direct_url, "headers": http_headers})
        except Exception as parse_exc:
            logger.error(f"Failed to parse yt-dlp video info: {parse_exc}")
            return JSONResponse({"error": f"Failed to parse video metadata: {parse_exc}"}, status_code=500)


@app.get("/")
def root():
    return JSONResponse({"status": "ok", "message": "Bitsongs mobile API"})


@app.get("/api/mobile/search")
def mobile_search(q: str = ""):
    return JSONResponse(search_songs(q))


@app.get("/api/mobile/chart")
def mobile_chart():
    return JSONResponse(get_chart())


@app.get("/api/mobile/recommend")
def mobile_recommend(song_id: str = ""):
    return JSONResponse(build_recommendation_response(song_id))


@app.get("/api/mobile/up_next")
def mobile_up_next(song_id: str = "", limit: int = 10):
    return JSONResponse(build_up_next_response(song_id, limit=limit or 10))


@app.get("/api/mobile/lyrics")
def mobile_lyrics(artist: str = "", title: str = ""):
    return JSONResponse(fetch_lyrics(artist, title))


@app.get("/api/mobile/play")
def mobile_play(request: Request, id: str = "", artist: str = "", title: str = "", previous_song_id: str | None = None):
    update_transition(previous_song_id, id)
    return render_play_response(request, id, artist, title)


@app.get("/api/mobile/stream_cache/{filename:path}")
def mobile_stream_cache(filename: str):
    filepath = CACHE_DIR / filename
    if not filepath.exists():
        return PlainTextResponse("Not Found", status_code=404)
    return FileResponse(filepath)


@app.get("/api/mobile/debug_cookies")
def debug_cookies():
    if os.getenv('OPENIFY_DEBUG') != '1':
        return PlainTextResponse('Not Found', status_code=404)
    import os
    from pathlib import Path
    
    cookies_txt_exists = Path("cookies.txt").exists()
    cookies_txt_size = Path("cookies.txt").stat().st_size if cookies_txt_exists else 0
    
    data_cookies_exists = Path("data/cookies.txt").exists()
    data_cookies_size = Path("data/cookies.txt").stat().st_size if data_cookies_exists else 0
    
    temp_file_exists = False
    temp_file_content_preview = ""
    if TEMP_COOKIE_FILE:
        p = Path(TEMP_COOKIE_FILE)
        temp_file_exists = p.exists()
        if temp_file_exists:
            try:
                temp_file_content_preview = p.read_text(encoding="utf-8")[:300]
            except Exception as e:
                temp_file_content_preview = f"Error reading: {e}"
                
    return {
        "TEMP_COOKIE_FILE_path": TEMP_COOKIE_FILE,
        "TEMP_COOKIE_FILE_exists": temp_file_exists,
        "TEMP_COOKIE_FILE_preview": temp_file_content_preview,
        "cookies_txt_exists": cookies_txt_exists,
        "cookies_txt_size": cookies_txt_size,
        "data_cookies_exists": data_cookies_exists,
        "data_cookies_size": data_cookies_size,
        "env_youtube_cookies_exists": bool(os.getenv("YOUTUBE_COOKIES")),
    }


def search_youtube_via_invidious(query: str) -> str | None:
    import requests
    from concurrent.futures import ThreadPoolExecutor, as_completed
    instances = [
        "https://invidious.projectsegfaut.im",
        "https://yewtu.be",
        "https://invidious.privacydev.net",
        "https://invidious.nerdvpn.de",
        "https://invidious.slipfox.xyz",
        "https://invidious.esmailelbob.xyz",
        "https://iv.ggtyler.dev",
        "https://invidious.lunar.icu",
        "https://invidious.flokinet.to",
    ]
    
    def check_instance(base):
        url = f"{base}/api/v1/search?q={requests.utils.quote(query)}&type=video"
        try:
            r = requests.get(url, timeout=2.5)
            if r.status_code == 200:
                results = r.json()
                if results and isinstance(results, list) and len(results) > 0:
                    video_id = results[0].get("videoId")
                    if video_id:
                        return video_id
        except Exception:
            pass
        return None

    try:
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(check_instance, base): base for base in instances}
            for future in as_completed(futures):
                res = future.result()
                if res:
                    logger.info(f"Resolved search via Invidious (parallel): {res}")
                    return res
    except Exception as e:
        logger.warning(f"Parallel Invidious search failed: {e}")
    return None


def search_youtube_via_piped(query: str) -> str | None:
    import requests
    from concurrent.futures import ThreadPoolExecutor, as_completed
    instances = [
        "https://pipedapi.kavin.rocks",
        "https://piped-api.garudalinux.org",
        "https://pipedapi.lunar.icu",
        "https://api.piped.yt",
        "https://pipedapi.ox.rs",
        "https://pipedapi.colby.cloud",
        "https://pipedapi.reallyawesomelink.co",
    ]
    
    def check_instance(base):
        url = f"{base}/search?q={requests.utils.quote(query)}&filter=videos"
        try:
            r = requests.get(url, timeout=2.5)
            if r.status_code == 200:
                results = r.json()
                items = results.get("items", [])
                if items:
                    url_path = items[0].get("url", "")
                    if "v=" in url_path:
                        video_id = url_path.split("v=")[-1]
                        return video_id
        except Exception:
            pass
        return None

    try:
        with ThreadPoolExecutor(max_workers=5) as pool:
            futures = {pool.submit(check_instance, base): base for base in instances}
            for future in as_completed(futures):
                res = future.result()
                if res:
                    logger.info(f"Resolved search via Piped (parallel): {res}")
                    return res
    except Exception as e:
        logger.warning(f"Parallel Piped search failed: {e}")
    return None


def search_youtube_via_ytdlp(query: str) -> str | None:
    ydl_opts = {
        "extract_flat": True,
        "playlist_items": "1",
        "quiet": True,
        "extractor_args": {
            "youtube": {
                "client": ["android", "ios"],
            }
        },
    }
    if TEMP_COOKIE_FILE:
        ydl_opts["cookiefile"] = TEMP_COOKIE_FILE
        
    proxy_env = os.getenv("YOUTUBE_PROXY")
    if proxy_env:
        ydl_opts["proxy"] = proxy_env
        
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(f"ytsearch1:{query}", download=False)
            if info and "entries" in info and len(info["entries"]) > 0:
                entry = info["entries"][0]
                video_id = entry.get("id")
                if video_id:
                    logger.info(f"Resolved search via yt-dlp search extractor: {video_id}")
                    return video_id
    except Exception as e:
        logger.warning(f"yt-dlp search failed with cookies: {e}")
        
    try:
        ydl_opts_nocookies = dict(ydl_opts)
        ydl_opts_nocookies.pop("cookiefile", None)
        with yt_dlp.YoutubeDL(ydl_opts_nocookies) as ydl:
            info = ydl.extract_info(f"ytsearch1:{query}", download=False)
            if info and "entries" in info and len(info["entries"]) > 0:
                entry = info["entries"][0]
                video_id = entry.get("id")
                if video_id:
                    logger.info(f"Resolved search via yt-dlp search extractor (no cookies): {video_id}")
                    return video_id
    except Exception as e:
        logger.warning(f"yt-dlp search failed without cookies: {e}")
        
    return None


@app.get("/api/mobile/test_extract")
def test_extract(video_id: str = "EBXHe2mHDI0", query: str = "Shibu - TAUBA audio"):
    if os.getenv('OPENIFY_DEBUG') != '1':
        return PlainTextResponse('Not Found', status_code=404)
    import yt_dlp
    
    results = {}
    results["invidious_search"] = search_youtube_via_invidious(query)
    results["piped_search"] = search_youtube_via_piped(query)
    
    cases = [
        ("android_music_no_cookies", ["android_music"], False),
        ("default_no_cookies", ["default", "-android_sdkless"], False),
    ]
    
    for name, clients, use_cookies in cases:
        ydl_opts = {
            "format": "bestaudio",
            "noplaylist": True,
            "quiet": True,
        }
        if clients:
            ydl_opts["extractor_args"] = {"youtube": {"player_client": clients}}
            
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(video_id, download=False)
                results[name] = {
                    "success": True,
                    "url_preview": info.get("url", "")[:100] if info else ""
                }
        except Exception as e:
            results[name] = {
                "success": False,
                "error": str(e)
            }
            
    return results


@app.get("/api/mobile/stream_proxy")
def mobile_stream_proxy(request: Request, url: str = "", headers: str = "{}"):
    if not url:
        return PlainTextResponse("No URL", status_code=400)
    return build_proxy_response(url, request.headers, headers)


@app.post("/api/mobile/cache_song")
async def mobile_cache_song(request: Request):
    data = await request.json()
    if not data:
        return JSONResponse({"error": "No data"}, status_code=400)
    executor.submit(download_task, str(data.get("id")), data.get("artist"), data.get("title"))
    return JSONResponse({"status": "queued"})


@app.get("/api/mobile/health")
def mobile_health():
    return JSONResponse({"status": "ok", "server": "Bitsongs", "version": "2.0", "timestamp": int(time.time())})


@app.post("/api/mobile/update_cookies")
async def update_cookies(request: Request):
    try:
        data = await request.json()
        cookie_content = data.get("cookies", "")
    except Exception:
        return JSONResponse({"status": "error", "message": "Invalid JSON payload"}, status_code=400)
        
    if not cookie_content:
        return JSONResponse({"status": "error", "message": "Cookies content cannot be empty"}, status_code=400)
        
    success = write_cookies_to_temp(cookie_content)
    if success:
        try:
            persistent_cookies_path = DATA_DIR / "cookies.txt"
            persistent_cookies_path.write_text(cookie_content, encoding="utf-8")
            logger.info(f"Saved cookies to persistent path: {persistent_cookies_path}")
        except Exception as e:
            logger.error(f"Failed to save persistent cookies: {e}")
        return JSONResponse({"status": "success", "message": "Cookies updated successfully"})
    else:
        return JSONResponse({"status": "error", "message": "Failed to update cookies"}, status_code=500)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("app:app", host="0.0.0.0", port=8000, reload=False)
