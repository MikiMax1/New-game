@echo off
title Port Solmar
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js is not installed yet.
  echo  Your browser will open the download page: install the LTS version,
  echo  then double-click "Start Game.bat" again.
  echo.
  start "" https://nodejs.org/en/download
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo  First start: installing the game's libraries. This takes a minute or two...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  Installing failed. Check your internet connection and try again.
    pause
    exit /b 1
  )
)

echo.
echo  Starting Port Solmar. Your browser will open at http://localhost:5173
echo  Keep this window open while you play. Close it to stop the game.
echo.
call npm run dev -- --open
pause
