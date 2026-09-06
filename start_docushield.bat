@echo off
title DocuShield All-In-One Launcher
color 0A
cd /d "%~dp0"

echo ================================================================
echo    DOCUSHIELD - SMART DOCUMENT SCANNING & VERIFICATION
echo ================================================================
echo.

echo [1/3] Starting FastAPI / Uvicorn Backend (Port 8000)...
start "DocuShield Backend (Uvicorn)" cmd /k "color 0B && python backend/server.py"

echo [2/3] Starting Frontend Web Server (Port 8080)...
start "DocuShield Frontend Server" cmd /k "color 0E && python -m http.server 8080"

echo [3/3] Waiting for servers to initialize...
timeout /t 2 /nobreak >nul

echo Opening DocuShield in your default browser: http://localhost:8080
start http://localhost:8080

echo.
echo ================================================================
echo    DocuShield is now LIVE!
echo    - Frontend Web App:  http://localhost:8080
echo    - Backend API Docs:  http://localhost:8000/docs
echo ================================================================
echo.
pause
