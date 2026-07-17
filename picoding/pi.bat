@ECHO off
SETLOCAL

REM Find picoding directory
SET "PICODING_DIR=%~dp0"

REM Find current working directory (where user typed 'pi')
SET "SESSION_DIR=%cd%"

REM Create junction from session dir -> picoding/.pi
REM If junction already exists, remove it first
IF EXIST "%SESSION_DIR%\.pi" (
    rmdir /S /Q "%SESSION_DIR%\.pi" 2>nul
)

mklink /J "%SESSION_DIR%\.pi" "%PICODING_DIR%.pi" >nul 2>&1

GOTO start
:find_dp0
SET dp0=%~dp0
EXIT /b
:start

IF EXIST "%dp0%\node.exe" (
  SET "_prog=%dp0%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --extension "%dp0%\.pi\extensions\auto-model-discovery.ts" %*
