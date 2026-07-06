@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

cd /d "%~dp0"

echo ========================================
echo   LLM Runner AIO - Electron Launcher
echo ========================================
echo.

REM Step 1: Node.js kontrolu
where node >nul 2^>^&1 || goto :no_node
echo [OK] Node.js bulundu
echo.

REM Step 2: npm install (Electron bagimliliklari)
if not exist "node_modules" (
    echo Installing Electron dependencies...
    call npm install
    if errorlevel 1 goto :install_failed
    echo [OK] Electron bagimliliklari yuklendi
) else (
    echo [SKIP] node_modules zaten mevcut
)
echo.

REM Step 3: INI Migration (Eski config.json → Yeni format)
if exist "launcher\config.json" (
    echo Migrating legacy config...
    node "src\utils\migrate-ini-to-urls.js" 2>nul
    if !errorlevel! equ 0 (
        echo [OK] Config migration completed
    )
)
echo.

REM Step 4: Uygulamayi baslat
echo ========================================
echo   LLM Runner AIO Baslatiliyor
echo ========================================
echo.
call npm start

echo.
pause
exit /b 0

:no_node
echo [ERROR] Node.js bulunamadi!
echo https://nodejs.org/ adresinden Node.js 18+ yukleyin.
echo.
pause
exit /b 1

:install_failed
echo [ERROR] npm install basarisiz!
echo.
pause
exit /b 1
