@ECHO off
SETLOCAL

REM Find picoding directory
SET "PICODING_DIR=%~dp0"

REM Copy .mcp.json to session dir with correct escaping (uses forward slashes)
IF EXIST "%PICODING_DIR%.mcp.json" (
    copy /Y "%PICODING_DIR%.mcp.json" "%cd%\.mcp.json" >nul 2>&1
)

REM Point to local pi-mcp-adapter package
SET "PI_PACKAGES=%PICODING_DIR%\node_modules\pi-mcp-adapter"

IF EXIST "%PICODING_DIR%\node.exe" (
  SET "_prog=%PICODING_DIR%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

"%_prog%" "%PICODING_DIR%\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --extension "%PICODING_DIR%\.pi\extensions\auto-model-discovery.ts" %*
