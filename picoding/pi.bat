@ECHO off
SETLOCAL

REM Find picoding directory and session directory
SET "PICODING_DIR=%~dp0"
SET "SESSION_DIR=%cd%"

REM Create junction from session dir -> picoding/.pi (for extensions/settings)
IF EXIST "%SESSION_DIR%\.pi" (
    rmdir /S /Q "%SESSION_DIR%\.pi" 2>nul
)
mklink /J "%SESSION_DIR%\.pi" "%PICODING_DIR%.pi" >nul 2>&1

REM Generate properly escaped .mcp.json with absolute VENV path
IF EXIST "%PICODING_DIR%\node.exe" (
  SET "_prog=%PICODING_DIR%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)
"%_prog%" "%PICODING_DIR%\write_mcp_json.js" "%PICODING_DIR%" "%SESSION_DIR%" 2>nul

REM Set PI_PACKAGES to point to local pi-mcp-adapter (via junction symlink)
SET "PI_PACKAGES=%PICODING_DIR%\node_modules\pi-mcp-adapter"

IF EXIST "%PICODING_DIR%\node.exe" (
  SET "_prog=%PICODING_DIR%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

"%_prog%" "%PICODING_DIR%\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --extension "%PICODING_DIR%\.pi\extensions\auto-model-discovery.ts" %*
