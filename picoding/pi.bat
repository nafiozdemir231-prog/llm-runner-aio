@echo off
REM pi.bat - pi komutunu çagr
REM -c flag: Devam eden session (previous session'u yükler)
cd /d "%~dp0"
node "node_modules/@earendil-works/pi-coding-agent/dist/cli.js" -c %*
