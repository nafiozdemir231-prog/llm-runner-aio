@ECHO off

REM Get script directory for path resolution
SET "PICODING_DIR=%~dp0"

IF EXIST "%PICODING_DIR%node.exe" (
  SET "_prog=%PICODING_DIR%node.exe"
) ELSE (
  SET "_prog=node"
  SET PATHEXT=%PATHEXT:;.JS;=;%
)

REM Run CLI without changing working directory (no endLocal pattern)
"%_prog%" "%PICODING_DIR%node_modules\@earendil-works\pi-coding-agent\dist\cli.js" %*
