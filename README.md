---
license: mit
---
# LLM Runner AIO - All-In-One Local AI Platform

> **Portable Windows Desktop App** — Run local AI models with a single click. No installation required.

## Overview

LLM Runner AIO is a comprehensive, self-contained desktop application that bundles all the tools you need to run local AI models on your own hardware. No complex setup, no dependency hell — just download, run, and start chatting with AI locally.

## What's Included

This package brings together four powerful open-source components into one seamless experience:

| Component | Description | License |
|-----------|-------------|---------|
| **Open WebUI** | Beautiful web interface for chatting with local LLMs (formerly Ollama WebUI) | MIT |
| **llama.cpp** | High-performance C++ inference engine for running LLMs locally | MIT |
| **SearXNG** | Privacy-respecting, metasearch engine for local web search | GPLv3 |
| **Vane** | AI-powered browser automation and web interaction tool | Open Source |

## Features

- 🚀 **Portable** — No installer needed. Move the folder anywhere and it works.
- 🔒 **100% Offline** — All processing happens on your machine, no data leaves your computer
- 🎨 **Modern UI** — Clean, dark-themed interface with support for 8 languages
- ⚙️ **Auto-Configuration** — Automatic hardware detection and optimal settings
- 🔄 **Multi-Service** — Manages all AI services from one dashboard
- 💾 **Persistent Database** — Your chat history and settings are saved locally
- 📱 **System Tray Integration** — Runs quietly in the background
- 🌐 **Port Configurable** — Customize ports for all services
- 🖥️ **Windows Autostart** — Auto-start with Windows (registry + desktop shortcut)
- 🔧 **Python venv Isolation** — Dependencies installed in isolated virtual environment
- 🗄️ **Manual Function Loading** — Inject `.json` functions directly into OpenWebUI

## How It Works

```
┌─────────────────────────────────────────────┐
│           LLM Runner AIO Launcher           │
├─────────────────────────────────────────────┤
│  ┌──────────┐  ┌──────────┐                │
│  │ SearXNG  │  │ llama.cpp│                │
│  │ :8080    │  │ :8000    │                │
│  └──────────┘  └──────────┘                │
│  ┌──────────┐  ┌──────────┐                │
│  │OpenWebUI │  │  Vane    │                │
│  │ :3000    │  │ :3001    │                │
│  └──────────┘  └──────────┘                │
└─────────────────────────────────────────────┘
```

1. **llama.cpp** runs the AI model inference engine
2. **Open WebUI** provides the chat interface at `http://localhost:3000`
3. **SearXNG** enables local web search at `http://localhost:8080`
4. **Vane** handles browser automation at `http://localhost:3001`

## System Requirements

| Requirement | Minimum | Recommended |
|-------------|---------|-------------|
| **OS** | Windows 10/11 | Windows 11 |
| **RAM** | 8 GB | 16 GB+ |
| **VRAM** | N/A | 4 GB+ |
| **Python** | 3.11+ (system) | 3.11+ (system) |
| **Node.js** | 18+ (system) | 20+ (system) |

> **Note:** Python 3.11 and Node.js must be installed on your system before running the app.

## Quick Start

### First Time Setup

1. **Download or clone** the repository:
   ```bash
   git clone https://github.com/nafiozdemir231-prog/llm-runner-aio.git
   cd llm-runner-aio
   ```

2. **Install system dependencies**:
   - Python 3.11+ (from https://python.org)
   - Node.js 18+ (from https://nodejs.org)

3. **Run the launcher**:
   ```bash
   # Windows — creates venv and starts the app
   .\run.bat
   
   # Or for silent background mode:
   cscript //Nologo electron\launch_app.vbs
   ```

4. **Open** your browser and go to `http://localhost:3000`
5. **Start chatting** with your local AI!

### Development Mode

```bash
# Install Electron dependencies
npm install

# Start with DevTools auto-opened
npm start -- --dev
```

### Windows Autostart

The app automatically configures itself on every launch:
- **Registry entry** → `HKCU\...\Run\LLMRunnerAIO` points to `electron/launch_app.vbs`
- **Desktop shortcut** → Created via PowerShell
- **Startup folder** → `.lnk` shortcut created in `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup`

All paths are resolved dynamically — move the folder and autostart still works.

### Building Distribution Package

```bash
npm run build:win    # Windows x64 NSIS installer
```

Built packages will be in the `dist/` directory.

## Supported Languages

The interface supports 8 languages:
- 🇹🇷 Turkish (Türkçe)
- 🇬🇧 English
- 🇪🇸 Spanish (Español)
- 🇩🇪 German (Deutsch)
- 🇫🇷 French (Français)
- 🇵🇹 Portuguese (Português)
- 🇨🇳 Chinese (中文)
- 🇯🇵 Japanese (日本語)

## Development Guide

### Architecture Overview

```
LLM-Runner-AIO/
├── electron/
│   ├── main.js              # Main process (lifecycle, IPC, autostart, cleanup)
│   ├── preload.js           # Context bridge (secure API exposure)
│   ├── launch_app.vbs       # Silent launcher for Windows autostart
│   └── create_shortcut.py   # Desktop shortcut creator
├── src/
│   ├── index.html           # UI structure
│   ├── css/style.css        # Modern transparent/minimal styling
│   ├── renderer.js          # Renderer process (DOM, tabs, logs)
│   ├── lang/                # 8 language files (en, tr, es, de, fr, pt, zh, ja)
│   └── assets/              # Icons, images
├── venv/                    # Python virtual environment (auto-created)
├── node_modules/            # Node.js + Electron dependencies
├── launcher/                # PyQt6 reference (legacy)
├── searxng/                 # SearXNG configuration & data
├── openwebui/               # OpenWebUI runtime directory
├── picoding/                # MCP Advisor settings
├── run.bat                  # Interactive launcher (creates venv, installs deps)
├── run_silent.bat           # Silent mode for autostart
├── Vane/                    # Vane Next.js app
├── gpu*.ini                 # Hardware-specific model presets
├── model_urls.json          # Model download URLs
└── requirements.txt         # Python dependencies
```

### Key Technologies

| Component | Technology |
|-----------|------------|
| Desktop Framework | Electron v28+ |
| UI | HTML5, CSS3, Vanilla JS |
| Process Management | child_process.spawn() + tree-kill |
| Database | SQLite (better-sqlite3) |
| Python Isolation | venv (auto-created by run.bat) |
| Autostart | Registry + VBS launcher + .lnk shortcuts |

### Adding New Features

1. **New Tab**: Add to `src/index.html`, create in `src/tabs/`, register in `renderer.js`
2. **New IPC Channel**: Add to `preload.js` (expose) and `main.js` (handler)
3. **New Language**: Add to `src/lang/*.json` (follow existing format)
4. **New Server**: Update `startServer()` in `main.js` spawn logic

## Data Privacy & Security

- ✅ **No Cloud Dependencies** — Everything runs locally
- ✅ **No Telemetry** — No data is sent anywhere
- ✅ **Local Database** — Chat history stored only on your machine
- ✅ **No Account Required** — No registration or login needed
- ✅ **Portable** — No registry entries left behind when moved

## License

This package is distributed under the **MIT License**. See `LICENSE.txt` for full details.

Individual components retain their original licenses:
- llama.cpp: MIT
- Open WebUI: MIT
- SearXNG: GPLv3

## Credits

This project would not be possible without the incredible work of:

- **Georgi Gerganov** — llama.cpp
- **Open WebUI Team** — Open WebUI
- **SearXNG Contributors** — SearXNG
- **All open-source contributors** who make local AI accessible

## Support

For questions, bug reports, or feature requests:

- **Website:** https://aihublocal.com/llm-runner-aio
- **Ko-fi:** Support the project at https://ko-fi.com/vincespeed

## Disclaimer

This software is provided "as is" without warranty of any kind. The developer (AIHubLocal) is not responsible for any data loss, system issues, or hardware strain resulting from use. Running local LLMs consumes significant system resources — users assume all risks associated with usage.


