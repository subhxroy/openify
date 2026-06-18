@echo off
echo =========================================
echo Starting Openify Mobile (Android Client)
echo =========================================

echo.
echo 1. Starting static HTTP server for the Android files on port 3000...
start "Openify Mobile Web Server" cmd /k "cd android && python -m http.server 3000"

echo 2. Waiting for server to initialize...
ping 127.0.0.1 -n 3 > nul

echo 3. Opening Openify Mobile in your web browser...
start http://localhost:3000

echo.
echo Mobile app running at http://localhost:3000
echo Server API expected at http://localhost:8000
echo.
echo Close the newly opened terminal window to stop the server.
