@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM ============================================================
REM LLM Runner AIO - DEV launcher (npm run dev / electron logging)
REM Shortcut'tan calistirilsa bile dogru klasorde baslar.
REM Test modu:  run-dev.bat --check   -> uygulamayi acmadan kontrol
REM ============================================================

cd /d "%~dp0" || (
    echo [ERROR] Proje klasorune girilemedi: %~dp0
    pause
    exit /b 1
)

echo ========================================
echo   LLM Runner AIO - DEV (^--enable-logging^)
echo   Calisma dizini: %CD%
echo ========================================
echo.

REM ---- Node.js kontrolu
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js bulunamadi! Kurun: https://nodejs.org/
    pause
    exit /b 1
)
for /f "delims=" %%v in ('node -v') do echo [OK] Node.js %%v

REM ---- npm kontrolu
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm bulunamadi - Node.js kurulumu eksik!
    pause
    exit /b 1
)

REM ---- Electron bagimliliklari
if not exist "node_modules\electron" (
    echo [!] node_modules\electron yok - npm install calistiriliyor...
    call npm install
    if errorlevel 1 (
        echo [ERROR] npm install basarisiz!
        pause
        exit /b 1
    )
)
echo [OK] Electron hazir

REM ---- Dosya kontrolu (electron . buradan yuklenir)
if not exist "electron\main.js" (
    echo [ERROR] electron\main.js bulunamadi - kisayol yanlis klasoru mu karsiliyor?
    echo         Kisayol hedefi: "%~f0"
    pause
    exit /b 1
)
if not exist "src\index.html" (
    echo [ERROR] src\index.html bulunamadi - repo eksik/bozuk gorunuyor.
    pause
    exit /b 1
)
echo [OK] electron\main.js + src\index.html yerinde

if /i "%~1"=="--check" (
    echo.
    echo [--check] Tum kontroller gecti - uygulama ACILMADI.
    exit /b 0
)

echo.
echo ========================================
echo   Baslatiliyor: npm run dev
echo   Konsolda Electron loglari canli akacak.
echo   Kapatmak icin: pencereyi kapatin veya Ctrl+C
echo ========================================
echo.

call npm run dev
set EXITCODE=%errorlevel%

if not "%EXITCODE%"=="0" (
    echo.
    echo [!] Uygulama %EXITCODE% koduyla cikti. Hata ayiklamasi icin:
    echo     1. Bu penceredeki loglari kontrol edin
    echo     2. node_modules\electron\dist\electron.exe var mi bakin
    echo     3. Gerekirse: call npm install
    pause
)
exit /b %EXITCODE%
