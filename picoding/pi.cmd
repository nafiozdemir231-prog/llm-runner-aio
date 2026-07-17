@ECHO off
SETLOCAL

REM Find picoding directory
SET "PICODING_DIR=%~dp0"

REM Find current working directory (where user typed 'pi')
SET "SESSION_DIR=%cd%"

REM Create junction from session dir -> picoding/.pi
IF EXIST "%SESSION_DIR%\.pi" (
    rmdir /S /Q "%SESSION_DIR%\.pi" 2>nul
)

mklink /J "%SESSION_DIR%\.pi" "%PICODING_DIR%.pi" >nul 2>&1

IF EXIST "%PICODING_DIR%\node.exe" (
  SET "_prog=%PICODING_DIR%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

"%_prog%" "%PICODING_DIR%\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --extension "%PICODING_DIR%\.pi\extensions\auto-model-discovery.ts" %*
