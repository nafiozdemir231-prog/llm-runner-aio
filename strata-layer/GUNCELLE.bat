@echo off
rem GUNCELLE.bat - update Strata: git pull (upstream code) + engine refresh via setup.py --update.
rem Do NOT use the upstream UPDATE.bat here (name clash); this is OUR updater. Pure ASCII + CRLF.
setlocal
cd /d "%~dp0"
echo [GUNCELLE] Backing up configs (models.json + gate configs)...
set BK=.tmp\backups\bat-latest
mkdir "%BK%" 2>nul
if exist local\models.json copy /y local\models.json "%BK%\" >nul && echo [GUNCELLE] backed up models.json
if exist strata-general.json copy /y strata-general.json "%BK%\" >nul
if exist strata-coder.json copy /y strata-coder.json "%BK%\" >nul
echo [GUNCELLE] Updating upstream code (git fetch)...
git fetch origin
if errorlevel 1 (
  echo [GUNCELLE] git fetch failed - check network, then run this again.
  pause
  exit /b 1
)
rem If upstream was rebased a plain fast-forward is impossible: reset onto origin/main instead
rem (our layer and configs are untracked files and survive a hard reset).
git merge-base --is-ancestor HEAD origin/main >nul 2>&1
if errorlevel 1 (
  echo [GUNCELLE] NOTE: upstream history was rebased - applying git reset --hard origin/main.
  git reset --hard origin/main
  if errorlevel 1 (
    echo [GUNCELLE] git reset failed - resolve manually, then run this again.
    pause
    exit /b 1
  )
) else (
  git pull --ff-only
  if errorlevel 1 (
    echo [GUNCELLE] git pull failed - resolve conflicts manually, then run this again.
    pause
    exit /b 1
  )
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
