@echo off
cd /d "%~dp0"
echo ========================================
echo   LLM Runner AIO - Electron Launcher
echo ========================================
echo.
where node >nul 2>&1 || (
    echo [ERROR] Node.js is NOT installed!
    echo Please install Node.js 18+ from: https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js found
echo.
echo Installing dependencies...
call npm install || (
    echo [ERROR] npm install failed!
    echo.
    pause
    exit /b 1
)
echo [OK] Dependencies installed
echo.
echo Compiling native modules...
call npx electron-rebuild -f -w better-sqlite3 || (
    echo [WARNING] better-sqlite3 compile skipped
    Run "npx electron-rebuild -f -w better-sqlite3" manually if needed.
)
echo.
echo ========================================
echo   Starting Application
echo ========================================
echo.
call npm start
echo.
pause
exit /b 0
