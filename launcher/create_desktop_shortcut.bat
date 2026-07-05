@echo off
set SCRIPT_DIR=%~dp0
set ROOT_DIR=%SCRIPT_DIR%..

"%ROOT_DIR%\venv\Scripts\python.exe" "%SCRIPT_DIR%create_shortcut.py"
exit /b %errorlevel%
