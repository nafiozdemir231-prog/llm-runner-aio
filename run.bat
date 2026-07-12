@echo off
setlocal enabledelayedexpansion
chcp 65001 >nul 2>&1

REM Change to the directory where this bat file is located
cd /d "%~dp0"

REM Venv python path
set VENV_PYTHON=%~dp0venv\Scripts\python.exe

echo ========================================
echo   LLM Runner AIO - Launcher
echo ========================================
echo.

REM Initial setup check
if not exist "venv\Scripts\python.exe" (
    echo ========================================
    echo   Initial setup detected
    echo ========================================
    echo.
    
    REM Find Python - try py launcher first (comes with Windows Python installer)
    set PYTHON_CMD=
    where py >nul 2>&1 && set PYTHON_CMD=py
    
    if "!PYTHON_CMD!"=="" (
        where python >nul 2>&1 && set PYTHON_CMD=python
    )
    
    if "!PYTHON_CMD!"=="" (
        where python3 >nul 2>&1 && set PYTHON_CMD=python3
    )
    
    if "!PYTHON_CMD!"=="" (
        echo.
        echo [ERROR] Python is NOT installed!
        echo.
        echo To install Python 3.11+:
        echo   https://www.python.org/downloads/
        echo.
        echo Run again after installation.
        echo.
        pause
        exit /b 1
    )
    
    echo Found Python: !PYTHON_CMD!
    echo Creating venv...
    !PYTHON_CMD! -m venv venv
    if errorlevel 1 (
        echo.
        echo [ERROR] venv creation failed!
        pause
        exit /b 1
    )
    echo [OK] venv created
    echo.
    
    echo Updating pip...
    %VENV_PYTHON% -m pip install --upgrade pip
    if errorlevel 1 (
        echo.
        echo [ERROR] pip update failed!
        pause
        exit /b 1
    )
    echo [OK] pip updated
    echo.
    
    echo Installing all dependencies...
    %VENV_PYTHON% -m pip install -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [ERROR] Dependencies installation failed!
        pause
        exit /b 1
    )
    echo [OK] All dependencies installed
    echo.
) else (
    echo venv already exists.
    echo.
    
    REM Check if dependencies are up to date
    echo Checking dependencies...
    %VENV_PYTHON% -m pip install --upgrade -r requirements.txt
    if errorlevel 1 (
        echo.
        echo [WARNING] Dependency update failed!
    ) else (
        echo [OK] Dependencies up to date
    )
    echo.
)

REM Node.js check
where node >nul 2>&1 || (
    echo.
    echo [ERROR] Node.js is NOT installed!
    echo.
    echo To install Node.js 18+:
    echo   https://nodejs.org/
    echo.
    pause
    exit /b 1
)
echo [OK] Node.js found
echo.

REM npm install (if node_modules missing or empty)
if not exist "node_modules" (
    echo Installing Electron dependencies...
    call npm install
    if errorlevel 1 (
        echo.
        echo [ERROR] npm install failed!
        pause
        exit /b 1
    )
    echo [OK] Electron dependencies installed
    echo.
) else (
    echo [SKIP] node_modules already exists
    echo.
)

REM Create desktop shortcut using create_shortcut.py
if exist "electron\create_shortcut.py" (
    echo Creating desktop shortcut...
    %VENV_PYTHON% electron\create_shortcut.py
    if errorlevel 1 (
        echo [WARNING] Shortcut creation failed.
    ) else (
        echo [OK] Desktop shortcut created
    )
    echo.
) else (
    echo [SKIP] create_shortcut.py not found, skipping shortcut.
    echo.
)

echo ========================================
echo   Starting LLM Runner AIO (Electron)...
echo ========================================
echo.

REM Launch application
call npm start

echo.
echo Press any key to exit...
pause
exit /b 0
