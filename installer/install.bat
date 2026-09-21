@echo off
title Forge IDE Installer
echo.
echo ============================================
echo         Forge IDE Installer
echo ============================================
echo.

:: Install Node.js if missing
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo Installing Node.js...
    powershell -NoProfile -ExecutionPolicy Bypass -Command "Invoke-WebRequest -Uri 'https://nodejs.org/dist/v20.18.0/node-v20.18.0-x64.msi' -OutFile '%TEMP%\n.msi'; Start-Process msiexec.exe -ArgumentList '/i','%TEMP%\n.msi','/qn' -Wait"
    set "PATH=C:\Program Files\nodejs;%PATH%"
)
node --version
echo.

:: Install Forge IDE
echo Installing Forge IDE...
call npm install -g "%~dp0forge-ide-1.0.0.tgz"
echo.

:: Install Chromium
echo Installing Chromium browser...
for /f "tokens=*" %%i in ('npm root -g') do set "R=%%i\forge-ide"
if not exist "%R%\src\index.js" set "R=%%i\@omar-azam\forge-agent"
call npx --prefix "%R%" playwright install chromium
echo.

:: Create launcher
for /f "tokens=*" %%i in ('npm config get prefix') do set "P=%%i"
set "C=%P%\forge-ide.cmd"
if not exist "%C%" (echo @echo off> "%C%" & echo cd /d "%R%">> "%C%" & echo node src/index.js --ide %%*>> "%C%")

:: Fix PowerShell wrapper
set "PS1=%P%\forge-ide.ps1"
> "%PS1%" (
    echo #!/usr/bin/env pwsh
    echo $d = Split-Path -Parent $MyInvocation.MyCommand.Definition
    echo & cmd.exe /c "%%d\forge-ide.cmd" @args
)

echo ============================================
echo           DONE! 
echo ============================================
echo.
echo Run: forge-ide
echo.
pause
