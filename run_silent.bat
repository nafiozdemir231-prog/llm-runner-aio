@echo off
chcp 65001 >nul 2>&1

REM ============================================================
REM CRITICAL: Force working directory to THIS script's location
REM Without this, Windows Startup runs from System32 = FAIL
REM ============================================================
cd /d "%~dp0"

REM ============================================================
REM Start Electron via npm (hardcoded path for reliability)
REM ============================================================
if exist "C:\Program Files\nodejs\npm.cmd" (
    call "C:\Program Files\nodejs\npm.cmd" start >nul 2>&1
) else if exist "C:\Users\%USERNAME%\AppData\Roaming\npm\npm.cmd" (
    call "C:\Users\%USERNAME%\AppData\Roaming\npm\npm.cmd" start >nul 2>&1
) else (
    REM Fallback to PATH
    where npm.cmd >nul 2>&1 && call npm start >nul 2>&1
)

exit /b 0
