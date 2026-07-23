🌐 Links

App Download Page: https://aihublocal.com/llm-runner-aio

Community LLM Configurations: https://aihublocal.com/llm/configs

Main Website: https://aihublocal.com

📋 Requirements

* Node.js and Python 3.11 must be installed.

* `LLM-Runner-AIO.exe` handles the automatic setup.

* After extracting the `LLM-Runner-AIO.rar` files, you must run `run.bat` first; this script installs the necessary dependencies, configures Pi Coding settings, and creates a desktop shortcut.

📦 What Does the Application Include?

* Open WebUI (Frontend interface) link: https://github.com/open-webui/open-webui

Searxng and `llama.cpp` server settings are pre-configured. You can also load functions found in the folder if you wish (e.g., EasySearch, Export to PDF/Excel/DOCX, unload `llama.cpp`, thinking toggle, pp/tg metrics).

* `llama.cpp` (Pre-compiled CUDA 13 + Vulkan versions) link: https://github.com/ggml-org/llama.cpp

These are the versions I have configured. 
vram12ram32models.ini, vram16ram32models.ini, 

* qwen3.6-35B-A3B

* gemma-4-26B-A4B

vram4ram32models.ini, vram6ram32models.ini, vram8ram32models.ini

* qwen3.6-35B-A3B

* gemma-4-26B-A4B

*gemma-4-E4B

vram24ram32models.ini

* qwen3.6-27B

*gemma-4-26B-A4B

vram32ram32models.ini

* qwen3.6-27B

* gemma-4-31B

vram4ram16models.ini, vram6ram16models.ini

* gemma-4-E4B

* qwen3.5-9B

* SearXNG (Completely private local web search) link: https://github.com/searxng/searxng

* Pi Coding (Pi is a minimal agent harness) link: https://github.com/earendil-works/pi

Web search and Advisor (use your own API key) pre-installed.

* Vane Search (For web search) link: https://github.com/ItzCrazyKns/Vane

llama.cpp and searxng settings pre-configured.

🚀 Key Features:

* No Manual Installation Required: It is a single 2 GB .exe file. Simply double-click and wait for the installation to complete. It automatically installs Python, Node, and all necessary dependencies within a local virtual environment (venv).

* Automatic Hardware Detection: The application automatically detects your GPU/VRAM and configures your system according to a specific hardware profile (VRAM options: 4GB, 6GB, 8GB, 12GB, 16GB, 24GB, and 32GB). * Smart Model Downloader: Simply select an auto-detection profile and click the model download button. The application filters and downloads models that perfectly match your VRAM capacity and configures llama.cpp accordingly.

* Optimized for Coding Agents: Includes parameters fine-tuned specifically for Qwen and Gemma models to maximize token speed and eliminate formatting or context loop issues in coding tools.

* 100% Open Source: You can review the entire source code on the website.
