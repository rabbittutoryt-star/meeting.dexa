@echo off
cd /d "%~dp0"
node --version >nul 2>&1 || (echo Install Node.js 18 or newer from https://nodejs.org/ & pause & exit /b 1)
start "" "http://localhost:3000"
node server.js
pause
