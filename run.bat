@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM Change to the directory where this bat file is located
cd /d "%~dp0"

echo ========================================
echo   LLM Runner AIO - Electron Launcher
echo ========================================
echo.

REM Check if Node.js is available
where node >nul 2>&1
if errorlevel 1 (
    echo.
    echo [ERROR] Node.js is NOT installed!
    echo.
    echo Please install Node.js 18+ from:
    echo   https://nodejs.org/
    echo.
    pause
    exit /b 1
)

echo Found Node.js
echo.

REM First-run setup: Install dependencies if missing
if not exist "node_modules\" (
    echo ========================================
    echo   Initial Setup Detected
    echo ========================================
    echo.
    
    echo Installing npm dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed!
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
    echo.
    
    echo Compiling native modules (better-sqlite3)...
    call npm run rebuild
    if errorlevel 1 (
        echo [WARNING] Native module compile skipped. Run 'npm run rebuild' manually if needed.
    ) else (
        echo [OK] Native modules compiled
    )
    echo.
)

REM Launch Electron application
echo ========================================
echo   Starting Application
echo ========================================
echo.

call npm start

echo.
echo Press any key to exit...
pause
exit /b 0
