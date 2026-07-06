@echo off
cd /d "%~dp0"
echo ========================================
echo   LLM Runner AIO - Electron Launcher
echo ========================================
where node >nul 2>&1 || (
    echo [ERROR] Node.js is NOT installed!
    echo Please install Node.js 18+ from: https://nodejs.org/
    pause
    exit /b 1
)
echo Found Node.js
if not exist "node_modules\" (
    echo Initial setup detected
    echo Installing npm dependencies...
    call npm install || (
        echo [ERROR] npm install failed!
        pause
        exit /b 1
    )
    echo [OK] Dependencies installed
    echo Compiling native modules...
    call npm run rebuild || echo [WARNING] Native module compile skipped
)
call npm start
pause
exit /b 0
