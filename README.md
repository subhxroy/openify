# Openify 🎵

[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue-purple.svg?style=flat-glass)](#)
[![Stack](https://img.shields.io/badge/stack-Electron%20%7C%20Node.js%20%7C%20Python-indigo.svg?style=flat-glass)](#)
[![License: MIT](https://img.shields.io/badge/License-MIT-blueviolet.svg?style=flat-glass)](LICENSE)

**Openify** is a premium, cross-platform desktop music player designed for audiophiles who appreciate high-end visual design. It features a retro-inspired vinyl turntable user interface, dynamic real-time canvas color extraction, space visualizer canvases, and a smart recommender backend. 

---

## 🎨 Visual Interface & Core Features

- **Retro Turntable Component**: Features a beautifully animated rotating vinyl record. During playback, the tonearm dynamically swings onto the record, mimicking physical playback systems.
- **Dynamic Accent Theming**: Integrated client-side canvas analysis extracts dominant color palettes from the active song's album art, updating the background gradients, glows, and buttons in real time.
- **Interactive Visualizers**: Drifting starry sky canvas background that reacts subtly to control changes and track loading states.
- **Apple Music / iTunes Integration**: Real-time searching of millions of catalog items.
- **Dynamic recommendation engine**: Runs in the background to analyze playback history and suggest future queue additions.

---

## 🛠️ Architecture & Folder Structure

Openify is built as a split-process application with a fast, sandboxed Electron browser container and a localized Python backend services wrapper:

```text
openify/
├── Bitsongs-Windows/        # Electron Frontend Shell
│   ├── main.js              # Electron Main Process (system window management)
│   ├── renderer.js          # Core GUI Logic (turntable logic, theme analysis)
│   ├── style.css            # Custom CSS Variable Tokens and Keyframe Animations
│   └── index.html           # Main player window template
├── Server/                  # Recommendation & Audio Utility Backend
│   ├── app.py               # Flask Application Server (catalog recommendation hooks)
│   ├── song_cache/          # Cached streaming resources (locally saved audio)
│   └── requirements.txt     # Python dependency configuration
├── android/                 # PWA Mobile Application Wrapper
│   ├── index.html           # Responsive Mobile Web Client Layout
│   └── sw.js                # Offline Service Worker configuration
├── start.bat                # Windows Launcher (launches Server and Electron Shell)
└── start-mobile.bat         # PWA Local Server Launcher
```

---

## 🚀 Getting Started

### Prerequisites

- **Node.js**: Version 18 or higher
- **Python**: Version 3.10 or higher
- **System Packages**: `ffmpeg` (must be added to system PATH)

---

### Windows (Quick Start)

Simply run the batch runner in the root folder:

```powershell
.\start.bat
```

This launches the Flask backend and Electron GUI automatically.

---

### Manual Setup & Execution

#### 1. Start the Flask Backend Services
```bash
cd Server
pip install -r requirements.txt
python app.py
```
The server will boot at `http://localhost:8000`.

#### 2. Start the Electron Application Shell
```bash
cd Bitsongs-Windows
npm install
npm start
```

---

### macOS Execution Steps

1. **Launch python server**
   ```bash
   cd Server
   pip install -r requirements.txt
   python app.py
   ```

2. **Configure client endpoints**
   Locate `Bitsongs/Services/NetworkService.swift` in the macOS folder and configure:
   ```swift
   @Published var baseURL: String = "http://localhost:8000"
   ```

3. **Run Xcode**
   Open the Xcode project file `Bitsongs.xcodeproj` and press `Cmd + R` to compile and run.

---

## 🗺️ Roadmap & Upcoming Features

- [ ] **Multi-provider streaming**: Extend catalog searches from Apple Music to include Spotify and YouTube Music.
- [ ] **Native audio visualizers**: Support real-time FFT frequency bars responding to audio output channels.
- [ ] **Local track library indexing**: Index local MP3/FLAC directories and combine them with streaming queues.
- [ ] **Offline playback caching**: Add automatic pre-download routines for cached songs.
