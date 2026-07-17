@ECHO off
SETLOCAL

REM Find picoding directory
SET "PICODING_DIR=%~dp0"

REM Use ONLY picoding/.pi for all configurations (NO global ~/.pi/)
SET "PI_SETTINGS_DIR=%PICODING_DIR%.pi"

REM Point to local pi-mcp-adapter package (NOT global npm)
SET "PI_PACKAGES=%PICODING_DIR%\node_modules\pi-mcp-adapter"

IF EXIST "%PICODING_DIR%\node.exe" (
  SET "_prog=%PICODING_DIR%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

"%_prog%" "%PICODING_DIR%\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --extension "%PICODING_DIR%\.pi\extensions\auto-model-discovery.ts" %*
