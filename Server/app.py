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


def fetch_lyrics(artist, title):
    try:
        resp = requests.get(
            "https://lrclib.net/api/search",
            params={"artist_name": artist, "track_name": title},
            headers={"User-Agent": "Bitsongs/1.0"},
            timeout=5,
        )
        data = resp.json()
        if isinstance(data, list) and data:
            for item in data:
                if item.get("syncedLyrics"):
                    return {"type": "synced", "text": item["syncedLyrics"]}
            for item in data:
                if item.get("plainLyrics"):
                    return {"type": "plain", "text": item["plainLyrics"]}
        return {"type": "error", "text": "No lyrics found."}
    except Exception as e:
        logger.exception("Fetch lyrics error for artist: %s, title: %s", artist, title)
        return {"type": "error", "text": "Lyrics unavailable."}


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
        ydl_opts = {
            "format": "bestaudio[ext=m4a]/bestaudio/best",
            "outtmpl": str(filepath),
            "noplaylist": True,
            "quiet": True,
            "js_runtimes": {"node": {}},
            "extractor_args": {"youtube": {"player_client": ["default", "-android_sdkless"]}},
        }
        
        proxy_env = os.getenv("YOUTUBE_PROXY")
        if proxy_env:
            ydl_opts["proxy"] = proxy_env
            
        if TEMP_COOKIE_FILE:
            ydl_opts["cookiefile"] = TEMP_COOKIE_FILE
            
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([f"ytsearch1:{query}"])
        except Exception as download_exc:
            logger.warning(f"Download failed with cookies: {download_exc}. Trying fallback without cookies...")
            ydl_opts_fallback = dict(ydl_opts)
            ydl_opts_fallback.pop("cookiefile", None)
            with yt_dlp.YoutubeDL(ydl_opts_fallback) as ydl:
                ydl.download([f"ytsearch1:{query}"])
                
        clear_cache_if_needed()
        logger.info(f"Successfully downloaded and cached song {song_id} to disk")
    except Exception as e:
        logger.exception("Download task exception for song: %s (%s - %s)", song_id, artist, title)
    finally:
        with DOWNLOADING_LOCK:
            CURRENTLY_DOWNLOADING.discard(song_id)


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

    # 3. Live extraction
    query = f"{artist} - {title} audio"
    ydl_opts = {
        "format": "bestaudio[ext=m4a]/bestaudio/best",
        "noplaylist": True,
        "quiet": False,
        "js_runtimes": {"node": {}},
        "extractor_args": {
            "youtube": {
                "player_client": ["default", "-android_sdkless"],
            }
        },
    }
    
    proxy_env = os.getenv("YOUTUBE_PROXY")
    if proxy_env:
        ydl_opts["proxy"] = proxy_env
        logger.info(f"Using proxy for yt-dlp: {proxy_env}")

    if TEMP_COOKIE_FILE:
        ydl_opts["cookiefile"] = TEMP_COOKIE_FILE
        
    extracted_info = None
    
    try:
        # Try extracting with cookies
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            extracted_info = ydl.extract_info(f"ytsearch1:{query}", download=False)
    except Exception as exc:
        logger.warning(f"Extraction failed with cookies: {exc}. Trying fallback without cookies...")
        # Fallback without cookies
        ydl_opts_fallback = dict(ydl_opts)
        ydl_opts_fallback.pop("cookiefile", None)
        try:
            with yt_dlp.YoutubeDL(ydl_opts_fallback) as ydl:
                extracted_info = ydl.extract_info(f"ytsearch1:{query}", download=False)
        except Exception as fallback_exc:
            logger.exception("Render play extract error for query: %s", query)
            return JSONResponse({"error": f"Song not found: {fallback_exc}"}, status_code=404)

    if extracted_info:
        try:
            video = extracted_info["entries"][0] if "entries" in extracted_info else extracted_info
            direct_url = video["url"]
            http_headers = video.get("http_headers", {})
            
            # Cache the extracted URL
            expire_at = parse_url_expiry(direct_url)
            STREAM_URL_CACHE[song_id] = {
                "direct_url": direct_url,
                "headers": http_headers,
                "expire_at": expire_at
            }
            save_stream_url_cache()
            logger.info(f"Cached stream URL for song {song_id}, expiring at {expire_at}")
            
            base_url = get_base_url(request)
            proxy_url = f"{base_url}/api/mobile/stream_proxy?url={quote(direct_url)}&headers={quote(json.dumps(http_headers))}"
            
            # Queue background download to local disk cache
            executor.submit(download_task, song_id, artist, title)
            
            return JSONResponse({
                "source": "youtube", 
                "url": proxy_url, 
                "direct_url": direct_url, 
                "headers": http_headers
            })
        except Exception as parse_exc:
            logger.error(f"Failed to parse video info: {parse_exc}")
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
