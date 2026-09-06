@echo off
title DocuShield Real-Time GitHub Auto-Sync
color 0B
echo =======================================================
echo    DocuShield GitHub Real-Time Auto-Sync Starting
echo =======================================================
echo.
cd /d "%~dp0"
python auto_sync.py
pause
