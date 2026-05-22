@echo off
echo =========================================
echo Starting Openify for Windows
echo =========================================

echo.
echo 1. Starting Python Backend Server in a new window...
start "Openify Backend Server" cmd /k "cd Server && python app.py"

echo 2. Waiting for server to initialize...
timeout /t 3 /nobreak > nul

echo 3. Starting Electron desktop client...
cd Bitsongs-Windows && npm start
