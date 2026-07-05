---
license: mit
---
# LLM Runner AIO - All-In-One Local AI Platform

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

- 🚀 **Single Executable** — Everything in one `.exe` file, no installation required
- 🔒 **100% Offline** — All processing happens on your machine, no data leaves your computer
- 🎨 **Modern UI** — Clean, dark-themed interface with support for 8 languages
- ⚙️ **Auto-Configuration** — Automatic hardware detection and optimal settings
- 🔄 **Multi-Service** — Manages all AI services from one dashboard
- 💾 **Persistent Database** — Your chat history and settings are saved locally
- 📱 **System Tray Integration** — Runs quietly in the background
- 🌐 **Port Configurable** — Customize ports for all services
- 🖥️ **Windows Startup** — Optional auto-start with Windows

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
| **GPU** | CPU Only | NVIDIA RTX 3060+ |
| **VRAM** | N/A | 6 GB+ |
| **Python** | 3.11 (bundled) | 3.11 (bundled) |
| **Node.js** | 18+ (bundled) | 20+ (bundled) |

> **Note:** Python 3.11 and Node.js are bundled inside the executable. No separate installation needed!

## Quick Start

1. **Download** `LLM-Runner-AIO.exe` (2.5 GB)
2. **Double-click** to run
3. **Open** your browser and go to `http://localhost:3000`
4. **Start chatting** with your local AI!

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

## Data Privacy

- ✅ **No Cloud Dependencies** — Everything runs locally
- ✅ **No Telemetry** — No data is sent anywhere
- ✅ **Local Database** — Chat history stored only on your machine
- ✅ **No Account Required** — No registration or login needed

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

