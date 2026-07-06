@echo off

cd /d "%~dp0"

echo ========================================
echo   LLM Runner AIO - Electron Launcher
echo ========================================
echo.

where node >nul 2^>^&1 || goto :no_node

echo [OK] Node.js found
echo.

if not exist "node_modules" goto :skip_install

:install_deps
echo Installing dependencies...
call npm install
if errorlevel 1 goto :install_failed
echo [OK] Dependencies installed
goto :launch_app

:skip_install
echo [SKIP] node_modules already exists

:launch_app
echo ========================================
echo   Starting Application
echo ========================================
echo.
call npm start

echo.
pause
exit /b 0

:no_node
echo [ERROR] Node.js is NOT installed!
echo Please install Node.js 18+ from:
echo https://nodejs.org/
echo.
pause
exit /b 1

:install_failed
echo [ERROR] npm install failed!
echo.
pause
exit /b 1
