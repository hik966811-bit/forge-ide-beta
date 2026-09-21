@echo off
setlocal enabledelayedexpansion
title Forge IDE - Prerequisites Installer
cd /d "%~dp0"

echo.
echo ===================================================
echo         Forge IDE - Setup Prerequisites
echo ===================================================
echo.
echo   This installs Node.js and the browser engine
echo   needed to run Forge IDE.
echo.

:: ── Step 1: Node.js ──────────────────────────────────────────────────────────
echo [1/3] Checking Node.js...

set "NODE_OK=0"
where node >nul 2>&1 && set "NODE_OK=1"
if "!NODE_OK!"=="1" goto :node_found

if exist "C:\Program Files\nodejs\node.exe" (
    set "PATH=C:\Program Files\nodejs;!PATH!"
    set "NODE_OK=1"
    goto :node_found
)
if exist "%LOCALAPPDATA%\Programs\nodejs\node.exe" (
    set "PATH=%LOCALAPPDATA%\Programs\nodejs;!PATH!"
    set "NODE_OK=1"
    goto :node_found
)

echo   Node.js NOT found. Downloading...
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$u='https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi';" ^
  "$o='%TEMP%\node-install.msi';" ^
  "Write-Host '  Downloading Node.js...';" ^
  "(New-Object Net.WebClient).DownloadFile($u,$o);" ^
  "Write-Host '  Installing (this may take a minute)...';" ^
  "Start-Process msiexec.exe -ArgumentList '/i',$o,'/qn' -Wait;" ^
  "Write-Host '  Done.'"
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo   FAILED. Install Node.js manually from https://nodejs.org
    echo.
    pause
    exit /b 1
)
set "PATH=C:\Program Files\nodejs;!PATH!"

:node_found
for /f "tokens=*" %%v in ('node --version 2^>nul') do echo   Node.js %%v installed.
echo.

:: ── Step 2: Find Forge IDE ───────────────────────────────────────────────────
echo [2/3] Locating Forge IDE...

set "FORGE_PATH="
for /f "tokens=*" %%i in ('npm config get prefix 2^>nul') do set "NPM_PREFIX=%%i"

if exist "!NPM_PREFIX!\node_modules\forge-ide\src\index.js" (
    set "FORGE_PATH=!NPM_PREFIX!\node_modules\forge-ide"
)
if not defined FORGE_PATH (
    echo   Forge IDE not found. Please install it first:
    echo   npm install -g forge-ide
    echo.
    pause
    exit /b 1
)
echo   Found: !FORGE_PATH!
echo.

:: ── Step 3: Install browser engine ──────────────────────────────────────────
echo [3/3] Installing browser engine (Chromium)...

if exist "!FORGE_PATH!\node_modules\playwright" (
    echo   Playwright found. Installing Chromium...
) else (
    echo   Installing dependencies...
    call npm install --prefix "!FORGE_PATH!" >nul 2>&1
)

call npx --prefix "!FORGE_PATH!" playwright install chromium >nul 2>&1
echo   Chromium ready.
echo.

:: ── Done ────────────────────────────────────────────────────────────────────
echo ===================================================
echo          Setup Complete!
echo ===================================================
echo.
echo   You can now run Forge IDE:
echo     - Double-click "Forge IDE" on your Desktop
echo     - Or run: forge-ide
echo.
echo ===================================================
echo.
pause
