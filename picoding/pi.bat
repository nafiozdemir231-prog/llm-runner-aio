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

REM Write dynamic .mcp.json with absolute VENV path for MCP server discovery
SET "VENV_PYTHON=%PICODING_DIR%..\venv\Scripts\python.exe"
(
echo {
echo   "mcpServers": {
echo     "web-reader": {
echo       "command": "%VENV_PYTHON%",
echo       "args": ["mcp/mcp_web_reader.py"]
echo     }
echo   }
echo }
) > "%SESSION_DIR%\.mcp.json" 2>nul

IF EXIST "%PICODING_DIR%\node.exe" (
  SET "_prog=%PICODING_DIR%\node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

"%_prog%" "%PICODING_DIR%\node_modules\@earendil-works\pi-coding-agent\dist\cli.js" --extension "%PICODING_DIR%\.pi\extensions\auto-model-discovery.ts" %*
