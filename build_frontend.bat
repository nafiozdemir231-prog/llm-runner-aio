@echo off
cd /d "%~dp0openwebui"
echo [BUILD] Installing npm dependencies...
call npm install
echo [BUILD] Building frontend...
call npm run build
echo [BUILD] Done!
pause
