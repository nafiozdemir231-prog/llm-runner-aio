@echo off
REM pi.cmd - picoding klasöründeki pi agent
REM Bu dosya picoding klasöründe çalışır, dış klasörlere çıkma yapmaz
REM -c flag: Devam eden session (previous session'u yükler)
cd /d "%~dp0"
node "node_modules/@earendil-works/pi-coding-agent/dist/cli.js" -c %*
