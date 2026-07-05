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

REM Helper scripts (first run)
if not exist "model_urls.json" (
    echo Creating model_urls.json...
    %VENV_PYTHON% migrate_ini_to_urls.py
)

REM .bat files (first run or if changed)
set NEED_BATS=0
for %%f in (vram*.ini) do (
    set BASE=%%~nf
    set BATFILE=start_!BASE:models=!.bat
    if not exist "!BATFILE!" set NEED_BATS=1
)
if "!NEED_BATS!"=="1" (
    echo Creating .bat files...
    %VENV_PYTHON% convert_to_relative.py
    %VENV_PYTHON% generate_bat_files.py
    %VENV_PYTHON% remove_ctx_from_ini.py
)

echo.
echo ========================================
echo   Starting...
echo ========================================
echo.

REM Create desktop shortcut
if not exist "launcher\create_shortcut.py" (
    echo [WARNING] create_shortcut.py not found, shortcut cannot be created.
) else (
    echo Creating desktop shortcut...
    %VENV_PYTHON% launcher\create_shortcut.py
    if errorlevel 1 (
        echo [WARNING] Shortcut creation failed.
    ) else (
        echo [OK] Desktop shortcut created
    )
    echo.
)

REM Launch application
%VENV_PYTHON% launcher\main.py

echo.
echo Press any key to exit...
pause
exit /b 0