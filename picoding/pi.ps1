# pi.ps1 - picoding klasöründeki pi agent (PowerShell)
$PICODING_DIR = $PSScriptRoot
$SESSION_DIR = $PWD.Path

# Create junction from session dir -> picoding/.pi (for extensions/settings)
if (Test-Path "$SESSION_DIR/.pi") {
    Remove-Item -Recurse -Force "$SESSION_DIR/.pi" | Out-Null
}
New-Item -ItemType Junction -Path "$SESSION_DIR/.pi" -Target "$PICODING_DIR/.pi" -Force | Out-Null

# Generate properly escaped .mcp.json with absolute VENV path
& "$PICODING_DIR\node.exe" "$PICODING_DIR\write_mcp_json.js" "$PICODING_DIR" "$SESSION_DIR" 2>$null

# Set PI_PACKAGES to point to local pi-mcp-adapter
$env:PI_PACKAGES = "$PICODING_DIR/node_modules/pi-mcp-adapter"

node "$PICODING_DIR/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" --extension "$PICODING_DIR/.pi/extensions/auto-model-discovery.ts" $args
