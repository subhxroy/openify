# Openify 🎵

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20PWA%20Mobile-blueviolet.svg?style=for-the-badge)](#)
[![Stack](https://img.shields.io/badge/stack-Electron%20%7C%20FastAPI%20%7C%20yt--dlp%20%7C%20HTML5%20Canvas-indigo.svg?style=for-the-badge)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg?style=for-the-badge)](LICENSE)

**Openify** is a premium, cross-platform desktop music player and PWA mobile application designed for audiophiles who appreciate high-end visual design. It features a retro-inspired vinyl turntable user interface, dynamic real-time canvas color extraction, space visualizer canvases, lyrics synchronization, and a smart recommender backend.

---

## 🎨 Visual Interface & Core Features

*   **Retro Turntable Component:** Features a beautifully animated rotating vinyl record. During playback, the tonearm dynamically swings onto the record, mimicking physical playback systems.
*   **Dynamic Accent Theming:** Integrated client-side canvas analysis extracts dominant color palettes from the active song's album art, updating the background gradients, glows, and buttons in real time.
*   **Interactive Visualizers:** Radial frequency-based styling and a drifting starry sky canvas background that reacts subtly to control changes and track loading states.
*   **Apple Music / iTunes Integration:** Real-time searching of millions of catalog items with fallback fuzzy local matching.
*   **Dynamic Recommendation Engine:** Runs in the background to analyze playback history and suggest future queue additions (up-next).
*   **Persistent State Management:** Stores user preferences, the active playback queue, repeat/shuffle status, and track position in `localStorage` to ensure a seamless experience upon refresh.
*   **Synced Lyrics Support:** Fetches and scrolls synced (`.lrc`) or plain text lyrics in real time, matching playback progress.

---

## 🛠️ Architecture & Folder Structure

Openify is built as a split-process application with a fast, sandboxed Electron container for desktop, a mobile PWA interface, and a Python FastAPI backend:

```text
openify/
├── Bitsongs-Windows/        # Electron Desktop Frontend Shell
│   ├── main.js              # Electron Main Process (system window management)
│   ├── renderer.js          # Core GUI Logic (turntable logic, theme analysis)
│   ├── style.css            # Custom CSS Variable Tokens and Keyframe Animations
│   └── index.html           # Main player window template
├── Server/                  # FastAPI Streaming & Recommendation Backend
│   ├── app.py               # FastAPI application server & stream controllers
│   ├── recommendation/      # Core recommendation engine (behavior & content)
│   │   ├── content.py       # Content-based recommendation routines
│   │   ├── collaborative.py # User behavioral matching
│   │   └── catalog.json     # Local catalog fallback metadata database
│   ├── cookies.txt          # Netscape cookie configuration for YouTube extraction
│   ├── requirements.txt     # Python dependency configuration
│   └── song_cache/          # Cached streaming resources (locally saved audio)
├── android/                 # PWA Mobile Application Wrapper
│   ├── index.html           # Responsive Mobile Web Client Layout
│   ├── app.js               # Mobile app interface controller & Firestore sync
│   └── sw.js                # Offline Service Worker configuration
├── start.bat                # Windows Launcher (launches Server and Electron Shell)
└── start-mobile.bat         # PWA Local Server Launcher
```

---

## 🔌 API Documentation (Backend)

The backend exposes a highly optimized FastAPI service for handling search, charts, streaming, recommendations, and cookie updates.

### Endpoints

| Endpoint | Method | Params | Description |
| :--- | :--- | :--- | :--- |
| `/` | `GET` | None | Service status and version check. |
| `/api/mobile/chart` | `GET` | None | Retrieves the top 25 trending songs from the iTunes India Chart. |
| `/api/mobile/search` | `GET` | `q` (string) | Searches the iTunes catalog with a fallback to local fuzzy catalog searches. |
| `/api/mobile/play` | `GET` | `id`, `artist`, `title`, `previous_song_id` | Live YouTube audio extractor. Returns JSON with a proxied stream URL. |
| `/api/mobile/recommend` | `GET` | `song_id` | Returns content-based and collaborative-based recommendations. |
| `/api/mobile/up_next` | `GET` | `song_id`, `limit` | Predicts and returns upcoming tracks based on active catalog patterns. |
| `/api/mobile/lyrics` | `GET` | `artist`, `title` | Queries synced or plain text lyrics from LrcLib. |
| `/api/mobile/stream_proxy` | `GET` | `url`, `headers` | Proxies the raw `.m4a` streams to bypass browser CORS and range restrictions. |
| `/api/mobile/update_cookies` | `POST` | JSON: `{"cookies": "..."}` | Live endpoint to update the YouTube session cookies. |

---

## 🚀 Getting Started

### Prerequisites

*   **Node.js**: Version 18 or higher
*   **Python**: Version 3.10 or higher
*   **System Packages**: `ffmpeg` (must be added to system PATH for media transcoding)

### Quick Run (Windows)

Double-click the batch file in the root folder:
```powershell
.\start.bat
```
This boots the FastAPI server at `http://localhost:8000` and launches the Electron application shell.

### Manual Setup & Execution

#### 1. Start the FastAPI Backend Services
```bash
cd Server
pip install -r requirements.txt
python app.py
```

#### 2. Start the Electron Application Shell
```bash
cd Bitsongs-Windows
npm install
npm start
```

---

## ⚠️ Troubleshooting YouTube Playback Blocks (Critical)

### The Problem (Root Cause)
Because Openify extracts audio streams from YouTube in the backend, standard hosting IPs (like Railway or AWS) are heavily flagged by YouTube's anti-bot system. This results in playback failing with a `404 Not Found` or a server exception in `yt-dlp`:
> **ERROR:** [youtube] Sign in to confirm you’re not a bot. Use --cookies-from-browser or --cookies for the authentication.

### The Solution: Updating Cookies
To bypass this, you must supply active, authenticated YouTube session cookies from a browser.

#### Step 1: Extract Cookies from Browser
1. Install a browser extension such as **Get cookies.txt LOCALLY** (Chrome/Firefox).
2. Go to [YouTube](https://www.youtube.com) and ensure you are logged in.
3. Open the extension and click **Export** (choose Netscape/cookies.txt format).
4. Save the file or copy its contents.

#### Step 2: Configure the Server
Openify uses a priority system to load cookies:
1. **Persistent Uploads:** Files uploaded via `/api/mobile/update_cookies` are stored in `Server/data/cookies.txt` and take top priority.
2. **Pushed Config:** Pushing a Netscape format file to `Server/cookies.txt` in the repository.
3. **Environment Variables:** The `YOUTUBE_COOKIES` environment variable configured in your hosting panel (e.g., Railway Dashboard).

To update live on Railway, either:
*   Make a POST request to `https://<your-railway-url>/api/mobile/update_cookies` with your cookie file string in the `"cookies"` JSON body field.
*   Paste the cookie string directly into the `YOUTUBE_COOKIES` environment variable in the Railway project dashboard.

---

## 🌐 Deployment (Frontend & Backend)

### Backend (Railway)
1. Link your GitHub repository to [Railway](https://railway.app).
2. Create a new service from the repository pointing to the `/Server` subdirectory.
3. Set the build command to `pip install -r requirements.txt` and startup command to `uvicorn app:app --host 0.0.0.0 --port $PORT`.
4. (Optional) Set the `YOUTUBE_PROXY` or `YOUTUBE_COOKIES` environment variables to bypass restrictions.

### Frontend (Netlify PWA)
1. Drag the `android` folder into Netlify, or link the repository and specify `android` as the publish directory.
2. Ensure `app.js` is configured with the correct `BASE_URL` pointing to your Railway backend:
   ```javascript
   const BASE_URL = 'https://your-railway-backend-url.up.railway.app';
   ```
