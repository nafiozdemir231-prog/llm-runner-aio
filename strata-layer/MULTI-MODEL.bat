@echo off
rem MULTI-MODEL.bat - start the Strata multi-model gateway (single port, model-based routing).
rem This file is OUR layer, not upstream. Keep it pure ASCII + CRLF.
setlocal
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo [MULTI-MODEL] .venv missing - run START-HERE.bat first.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" local\gateway.py local\models.json %*
if errorlevel 1 pause
exit /b
