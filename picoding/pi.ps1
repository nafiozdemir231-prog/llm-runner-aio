# pi.ps1 - picoding klasöründeki pi agent (PowerShell)
$PICODING_DIR = $PSScriptRoot

# Copy .mcp.json to session dir with correct escaping
if (Test-Path "$PICODING_DIR\.mcp.json") {
    Copy-Item "$PICODING_DIR\.mcp.json" "$PWD\.mcp.json" -Force 2>$null
}

# Point to local pi-mcp-adapter package
$env:PI_PACKAGES = "$PICODING_DIR\node_modules\pi-mcp-adapter"

node "$PICODING_DIR/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" --extension "$PICODING_DIR/.pi/extensions/auto-model-discovery.ts" $args
