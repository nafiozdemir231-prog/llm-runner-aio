@echo off
title llama.cpp (vram32ram32models.ini)
color 0a

echo [Llama.cpp] Baslatiliyor: vram32ram32models.ini
echo [Config] vram32ram32models.ini
echo.

cd /d "%~dp0"
"llama.cpp-cuda13+vulkan\llama-server.exe" ^
  --host 0.0.0.0 ^
  --port 1234 ^
  --models-max 1 ^
  --models-preset "gpu1vram32ram32models.ini" ^
  --jinja

pause
