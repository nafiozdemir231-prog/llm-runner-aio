@echo off
title llama.cpp (gpu1vram6ram32models.ini)
color 0a

cd /d "%~dp0"
"llama.cpp-cuda13+vulkan\llama-server.exe" ^
  --host 0.0.0.0 ^
  --port 1234 ^
  --ctx-size 65536 ^
  --models-max 1 ^
  --models-preset "gpu1vram6ram32models.ini" ^
  --jinja

pause
