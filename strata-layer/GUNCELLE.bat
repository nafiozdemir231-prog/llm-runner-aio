@echo off
rem GUNCELLE.bat - update Strata: git pull (upstream code) + engine refresh via setup.py --update.
rem Do NOT use the upstream UPDATE.bat here (name clash); this is OUR updater. Pure ASCII + CRLF.
setlocal
cd /d "%~dp0"
echo [GUNCELLE] Updating upstream code (git pull --ff-only)...
git pull --ff-only
if errorlevel 1 (
  echo [GUNCELLE] git pull failed - resolve conflicts manually, then run this again.
  pause
  exit /b 1
)
rem Our layer must survive the pull: restore it from tracked copies if something went missing.
if not exist "local" mkdir local
for %%F in (gateway.py checkargs.py models.json) do (
  if not exist "local\%%F" (
    if exist "..\strata-layer\%%F" (
      copy /y "..\strata-layer\%%F" "local\%%F" >nul
      echo [GUNCELLE] restored local\%%F from ..\strata-layer
    ) else echo [GUNCELLE] WARNING: local\%%F missing and no backup found.
  )
)
if not exist MULTI-MODEL.bat if exist "..\strata-layer\MULTI-MODEL.bat" copy /y "..\strata-layer\MULTI-MODEL.bat" "MULTI-MODEL.bat" >nul && echo [GUNCELLE] restored MULTI-MODEL.bat
if not exist GUNCELLE.bat echo [GUNCELLE] WARNING: GUNCELLE.bat missing.
if exist ".venv\Scripts\python.exe" (
  echo [GUNCELLE] Refreshing the engine (setup.py --update)...
  ".venv\Scripts\python.exe" setup.py --update
) else echo [GUNCELLE] no .venv yet - engine refresh will happen on first START-HERE.bat run.
echo [GUNCELLE] Done. Start with MULTI-MODEL.bat (or the LLM-Runner app).
pause
exit /b
