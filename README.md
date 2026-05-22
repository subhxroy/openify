# Openify 🎵

A premium cross-platform desktop music player with a retro vinyl turntable UI. Streams audio via a Python backend.

## Requirements

### Windows
- Windows 10/11
- Node.js 18+
- Python 3.10+

### macOS
- macOS 13+
- Xcode 15+
- Python 3.10+

## How to Run on Windows (Quick Start)

Double-click `start.bat` in the root folder, or run it in your terminal:
```powershell
.\start.bat
```
This automatically starts the Python backend and launches the Electron application window.

### Manual Steps for Windows:

1. **Start the server**
   ```bash
   cd Server
   pip install -r requirements.txt
   python app.py
   ```
   The backend runs at `http://localhost:8000`.

2. **Start the Client**
   ```bash
   cd Bitsongs-Windows
   npm install
   npm start
   ```

---

## How to Run on macOS

1. **Start the server**
   ```bash
   cd Server
   pip install -r requirements.txt
   python app.py
   ```
   Server runs at `http://localhost:8000`.

2. **Set the URL in the app**
   Open `Bitsongs/Services/NetworkService.swift` and set:
   ```swift
   @Published var baseURL: String = "http://localhost:8000"
   ```

3. **Build & run**
   Open `Bitsongs.xcodeproj` in Xcode → `Cmd + R`.

---

## Usage & Features

- **Split dynamic UI**: Replicates the Midnight Indigo / Vanilla Cream styling.
- **Dynamic Theming**: Color extraction canvas matches backgrounds and accents to the current track's album cover dynamically.
- **Vinyl disc & Needle arm animations**: Real-time rotating vinyl turntable and needle arm moving to the disc during playback.
- **Starry Sky Background**: Animated space canvas with drifting stars.
- **Search**: Type in the search bar to query the Apple Music/iTunes catalog.
- **Up Next**: Continuous queue suggestions powered by backend content recommendations.
- **Volume & Seek**: Full range slider control and seekbar scrubbing support.
