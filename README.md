# DayDreamin 🎵

A macOS music player with a vinyl turntable UI. Streams audio via a Python backend.

## Requirements

- macOS 13+
- Xcode 15+
- Python 3.10+

## Run Locally

**1. Start the server**
```bash
cd Server
pip install -r requirements.txt
python app.py
```
Server runs at `http://localhost:8000`.

**2. Set the URL in the app**

Open `Bitsongs/Services/NetworkService.swift` and set:
```swift
@Published var baseURL: String = "http://localhost:8000"
```

**3. Build & run**

Open `Bitsongs.xcodeproj` in Xcode → `Cmd + R`.

## Usage

- **Search** — type in the left panel search bar
- **Play** — click any song from the list
- **Seek** — drag the progress bar at the bottom
- **Volume** — slider on the bottom right
- **Skip** — use the ⏮ / ⏭ buttons
