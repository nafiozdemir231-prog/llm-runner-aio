// write_mcp_json.js - Generate properly escaped .mcp.json with absolute VENV path
const fs = require('fs');
const path = require('path');

// Arguments: [picoding_dir] [session_dir]
const picodingDir = process.argv[2];
const sessionDir = process.argv[3];

if (!picodingDir || !sessionDir) {
  console.error('Usage: node write_mcp_json.js <picoding_dir> <session_dir>');
  process.exit(1);
}

// Resolve absolute path to venv python
const venvPython = path.resolve(picodingDir, '..', 'venv', 'Scripts', 'python.exe')
  .replace(/\\/g, '/'); // Convert backslashes to forward slashes for JSON safety

const mcpConfig = {
  mcpServers: {
    'web-reader': {
      command: venvPython,
      args: ['mcp/mcp_web_reader.py']
    }
  }
};

const outputPath = path.join(sessionDir, '.mcp.json');
fs.writeFileSync(outputPath, JSON.stringify(mcpConfig, null, 2) + '\n', 'utf8');
console.log(`[pi] MCP config written to ${outputPath}`);
