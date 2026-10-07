---
language:
- en
- tr
- fr
- de
- ja
- zh
- es
- pt
license: mit
base_model:
- google/gemma-4-26B-A4B-it-qat-q4_0-gguf
- google/gemma-4-31B-it
- Qwen/Qwen3.8-27B
- Qwen/Qwen3.6-35B-A3B
- inclusionAI/Ling-3.0-tiny
- google/gemma-4-E4B-it
- ISTA-DASLab/Qwen3.8-Flash-Next-GSQ-RCO-GGUF
tags:
- gguf
- moe
- dense
- llama.cpp
- searxng
- qwen
- gemma
- wan2gp
- openwebui
- strata
---

# LLM Runner AIO v1.9

🌐 Links

App Download Page: https://aihublocal.com/llm-runner-aio

Community LLM Configurations: https://aihublocal.com/llm/configs

Main Website: https://aihublocal.com

📋 Requirements

* Node.js and Python 3.11 must be installed.

* Optional Wan2GP video service: needs a few extra GB of disk space and the CUDA/driver version matching your GPU generation (exact requirements are shown in the setup confirmation window).

* Optional Strata service (local 100B-class MoE chat): requires at least 48 GB RAM and 12 GB VRAM; the model download is ~58–84 GB into the local `models\` folder. The card only appears on machines that meet these thresholds.

* `LLM-Runner-AIO.exe` handles the automatic setup.

* After extracting the `LLM-Runner-AIO.rar` files, you must run `run.bat` first; this script installs the necessary dependencies, configures Pi Coding settings, and creates a desktop shortcut.

📦 What Does the Application Include?

* Open WebUI (Frontend interface) link: https://github.com/open-webui/open-webui

Searxng and `llama.cpp` server settings are pre-configured. You can also load functions found in the folder if you wish (e.g., EasySearch, Export to PDF/Excel/DOCX, unload `llama.cpp`, thinking toggle, pp/tg metrics).

* `llama.cpp` (Pre-compiled CUDA 13 + Vulkan versions) link: https://github.com/ggml-org/llama.cpp

These are the versions I have configured (most models below ship with chat, vision and coding profiles):

| VRAM    | RAM  | Models |
| ------- | ---- | ------ |
| 4 / 6 GB | 32 GB | qwen3.6-35B-A3B · gemma-4-26B · gemma-4-E4B |
| 8 GB     | 32 GB | qwen3.6-35B-A3B · gemma-4-26B · gemma-4-E4B · qwen3.8-27B |
| 10 GB    | 32 GB | qwen3.6-35B-A3B · gemma-4-26B · qwen3.8-27B |
| 12 GB    | 32 GB | qwen3.6-35B-A3B · gemma-4-26B · qwen3.8-27B |
| 16 GB    | 32 GB | qwen3.6-35B-A3B · gemma-4-26B · qwen3.8-27B (DFlash2 draft) |
| 24 GB    | 32 GB | qwen3.8-27B · gemma-4-26B |
| 32 GB    | 32 GB | qwen3.8-27B · gemma-4-31B |
| 4 GB     | 16 GB | gemma-4-E4B · qwen3.5-4B · Ling-3.0-tiny · MiniCPM5-2B · Spark-X2.5-4B |
| 6 GB     | 16 GB | gemma-4-E4B · qwen3.5-9B · Ling-3.0-tiny · MiniCPM5-2B · Spark-X2.5-4B |

All of the model lists above can be managed directly from the GUI — no manual INI editing needed (see “GUI Model Manager” in Key Features).

* SearXNG (Completely private local web search) link: https://github.com/searxng/searxng

* Pi Coding (Pi is a minimal agent harness) link: https://github.com/earendil-works/pi

Web search and Advisor (use your own API key) pre-installed.

* Vane Search (For web search) link: https://github.com/ItzCrazyKns/Vane

llama.cpp and searxng settings pre-configured.

* Wan2GP (AI image/video generation, runs locally) link: https://github.com/deepbeepmeep/Wan2GP

Optional integrated service. Press "Setup" in the Wan2GP card (System tab): the app clones the repository, builds a dedicated virtual environment (`venvs/wan2gp`) and installs the package set matching your GPU generation — without touching the rest of the app. The built-in Deepy assistant can optionally offload its LLM reasoning to another PC on your local network (Remote LLM mode).

* Strata (multi-model local gateway, runs locally) link: https://github.com/Niko1221/Strata

Optional high-end service for 48 GB+ machines. One port (default **1235**, OpenAI + Anthropic API) exposes two model names — `Qwen3.8-Flash-Next` and `coder-Qwen3.8-Flash-Next` — that share a single engine; only the sampling profile differs, so the ~60–84 GB MoE model is never loaded twice. Setup downloads the quant you pick (IQ1_M / Q2_0 / IQ2_XS / IQ3_XXS / IQ3_S), calibration measures your exact CPU/GPU/RAM balance, and an idle timer unloads the model after 10 minutes without requests. Choose "This PC Only" or "Local Network" binding (an API key is generated automatically for LAN mode — Open WebUI gets it automatically too), optionally enable image reading (vision on GPU or CPU), and keep the gateway up to date with one Update button that preserves all your settings.

🚀 Key Features:

* No Manual Installation Required: It is a single ~2.3 GB .exe file. Simply double-click and wait for the installation to complete. It automatically installs Python, Node, and all necessary dependencies within a local virtual environment (venv).

* Automatic Hardware Detection: The application automatically detects your GPU/VRAM and configures your system according to a specific hardware profile (VRAM options: 4GB, 6GB, 8GB, 12GB, 16GB, 24GB, and 32GB). * Smart Model Downloader: Simply select an auto-detection profile and click the model download button. The application filters and downloads models that perfectly match your VRAM capacity (including any speculative draft models defined in the preset) and configures llama.cpp accordingly.

* GUI Model Manager: Add, edit, or remove models straight from the System tab. The app rewrites the active preset INI safely (comments and order preserved), keeps the corresponding download URLs in sync in `model_urls.json` (main, MMProj and draft URLs), and offers one-click URL health checks for a single model or for every model at once.

* Built-in Video Generation (Wan2GP): The app detects your GPU generation, picks the right package (NVIDIA GTX 10xx – RTX 50xx, AMD RX 6xxx / 7xxx / 9xxx / APU, Intel Arc), and lets you install, start, stop and monitor the Wan2GP server from the same screen. Port and network binding are configurable (default port: 7860).

* Multi-Model Local Gateway (Strata): On 48 GB+ machines, a single API port serves both a general and a coding persona of the same Qwen3.8-Flash-Next MoE model with one shared engine (signature-based ark sharing, swap rules, idle unload). One-click buttons handle download & install, hardware calibration, Open WebUI connection and safe updates; auto-start can bring the gateway up with Windows.

* Optimized for Coding Agents: Includes parameters fine-tuned specifically for Qwen and Gemma models to maximize token speed and eliminate formatting or context loop issues in coding tools.

* Speculative Decoding: The 16 GB preset runs qwen3.8-27B together with a DFlash2 draft model for higher token speed; draft models are downloaded, listed and managed alongside the main model.

* 100% Open Source: You can review the entire source code on the website.