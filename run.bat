@echo off
setlocal enabledelayedexpansion
cd /d "%~dp0"

echo ========================================
echo   LLM Runner AIO - Electron Launcher
echo ========================================
echo.

REM Check Node.js
where node >nul 2>&1 || (
    echo [ERROR] Node.js is NOT installed!
    echo Please install Node.js 18+ from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js found
echo.

REM Step 1: Install npm dependencies
if not exist "node_modules\" (
    echo ========================================
    echo   Step 1/2 — Installing Dependencies
    echo ========================================
    echo.
    call npm install || (
        echo [ERROR] npm install failed!
        echo.
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
    echo.
) else (
    echo [SKIP] node_modules already exists
    echo.
)

REM Step 2: Rebuild native modules
echo ========================================
echo   Step 2/2 — Compiling Native Modules
echo ========================================
echo.
call npm run rebuild || (
    echo [WARNING] better-sqlite3 compile skipped
    echo Run "npm run rebuild" manually if needed.
)
echo.

REM Launch Electron
echo ========================================
echo   Starting Application
echo ========================================
echo.
call npm start

echo.
pause
exit /b 0
