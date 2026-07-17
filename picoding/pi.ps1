# pi.ps1 - picoding klasöründeki pi agent (PowerShell)
# Bu script sadece picoding klasöründe çalışır
# -c flag: Devam eden session (previous session'u yükler)
$PICODING_DIR = $PSScriptRoot
$SESSION_DIR = $PWD.Path

# Create junction from session dir -> picoding/.pi (for extensions/settings)
if (Test-Path "$SESSION_DIR/.pi") {
    Remove-Item -Recurse -Force "$SESSION_DIR/.pi"
}
New-Item -ItemType Junction -Path "$SESSION_DIR/.pi" -Target "$PICODING_DIR/.pi" -Force | Out-Null

# Write dynamic .mcp.json with absolute VENV path for MCP server discovery
$VENV_PYTHON = "$PICODING_DIR/../venv/Scripts/python.exe"
@"
{
  "mcpServers": {
    "web-reader": {
      "command": "$VENV_PYTHON",
      "args": ["mcp/mcp_web_reader.py"]
    }
  }
}
"@ | Out-File -FilePath "$SESSION_DIR/.mcp.json" -Encoding ascii

# Set PI_PACKAGES to point to local pi-mcp-adapter (via junction symlink)
$env:PI_PACKAGES = "$PICODING_DIR/node_modules/pi-mcp-adapter"

Set-Location $PICODING_DIR
node "$PICODING_DIR/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" --extension "$PICODING_DIR/.pi/extensions/auto-model-discovery.ts" $args
