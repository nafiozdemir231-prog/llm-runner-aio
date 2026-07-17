# pi.ps1 - picoding klasöründeki pi agent (PowerShell)
# Uses ONLY picoding/.pi for all configurations (NO global ~/.pi/)
$PICODING_DIR = $PSScriptRoot

# Use ONLY picoding/.pi for all configurations (NO global ~/.pi/)
$env:PI_SETTINGS_DIR = "$PICODING_DIR\.pi"

# Point to local pi-mcp-adapter package (NOT global npm)
$env:PI_PACKAGES = "$PICODING_DIR\node_modules\pi-mcp-adapter"

node "$PICODING_DIR/node_modules/@earendil-works/pi-coding-agent/dist/cli.js" --extension "$PICODING_DIR/.pi/extensions/auto-model-discovery.ts" $args
