# Openify Mobile Client

This directory contains the completely separate, premium, mobile-optimized web application for Openify. It mimics the visual design system of the desktop app (rotating vinyl, needle arm, starry canvas background, HSL color shifting) but uses a mobile-responsive interface (sticky mini-player, bottom navigation tabs, bottom sheet overlays, swipe gestures) similar to Spotify Mobile.

## Structure

*   `index.html`: Mobile-first HTML layout, featuring responsive layout viewports, mini-player, bottom tab navigations, slide-up fullscreen Now Playing layout, and category search grids.
*   `style.css`: Viewport-unit styles (`vw`/`vh`), touch target sizing (minimum 48px), slide transitions, vinyl spinning animation, and canvas settings.
*   `app.js`: Audio playback manager, LocalStorage playlist integration, debounced search, genre category queries, canvas star particle animation, dynamic cover-art color extraction, and swipe handlers.
*   `playlistStore.js`: Client-side LocalStorage CRUD wrapper. Uses `openify_mobile_playlists` namespace to prevent data collision with the desktop Electron client.

## Setup & Running

To run and preview the mobile client locally:

### Option 1: Live Server (Recommended)
You can run a local HTTP server inside the `android/` directory. For example, if you have python:
```bash
cd android
python -m http.server 3000
```
Then visit `http://localhost:3000` in your web browser.

### Option 2: Direct File Loading
Double-click `android/index.html` to open it directly via the `file://` protocol in any web browser. (Note: Audio streaming will work, but some browsers might enforce CORS limitations when loading covers on a canvas for color extraction unless served via HTTP).

## Previewing Mobile Viewport
1. Open your web browser (Chrome, Edge, Firefox, or Safari).
2. Press `F12` (or `Ctrl + Shift + I` / `Cmd + Option + I` on macOS) to open **Developer Tools**.
3. Click the **Device Toolbar Icon** (looks like a phone/tablet outline) or press `Ctrl + Shift + M`.
4. Choose a device preset (e.g., **iPhone 12 Pro**, **Pixel 5**, or set size manually to `360 x 800`).
5. Touch the screen elements to interact with the responsive layouts.

## Spotify-Like Features Included

*   **Mini-Player**: Sticky player at the bottom, just above navigation. Displays current song info and a micro-progress bar. Swipe up or tap to reveal the full-screen player.
*   **Swipe-to-Minimize / Swipe-to-Open**: Drag/Swipe down on Now Playing header to slide it down, or swipe up on the mini-player to open it.
*   **Genre Tiles**: Search page displays colored gradient categories (Pop, Rock, Chill, Electronic, Lofi, Hiphop). Tapping any tile triggers a direct query search.
*   **Favorites Heart Button**: Directly add or remove the currently playing song from your "My Favorites" library playlist using the heart icon on the Now Playing screen.
*   **Dynamic Backgrounds**: Extracts primary, secondary, and accent HSL values from the playing song's artwork and applies them across background gradients, slanted layouts, vinyl centers, and buttons.
