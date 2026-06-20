@echo off
echo =========================================
echo Starting Openify for Windows
echo =========================================

echo.
echo 1. Starting Python Backend Server in a new window...
echo Installing Python dependencies...
cd Server && pip install -r requirements.txt && cd ..

start "Openify Backend Server" cmd /k "cd Server && python app.py"

echo 2. Waiting for server to initialize...
timeout /t 3 /nobreak > nul

echo 3. Starting Electron desktop client...
echo Installing Node dependencies...
cd Bitsongs-Windows && if not exist node_modules npm install && npm start
