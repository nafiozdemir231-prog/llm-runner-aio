"""
LLM Runner AIO - Kurulum Sihirbazi
Ilk kurulumda her seyi otomatik yapar:
- Python kontrolu
- venv olusturma
- Paket kurulumu (PyQt6, psutil, open-webui, searxng, huggingface_hub)
- Yardimci scriptleri calistirma
- Masaustu kisayolu
- PATH duzenleme (Pi Coding)
- Port konfigurasyonu
"""

import sys
import subprocess
import json
import os
import platform
from pathlib import Path


ROOT = Path(__file__).parent
VENV_DIR = ROOT / "venv"
CONFIG_PATH = ROOT / "launcher" / "config.json"
PICODING_DIR = ROOT / "picoding"


def print_step(msg, char="="):
    print(f"\n{char * 60}")
    print(f"  {msg}")
    print(f"{char * 60}")


def check_python():
    """Python 3.11+ kontrolu"""
    print_step("Python kontrolu", "-")
    v = sys.version_info
    if v < (3, 11):
        print(f"[HATA] Python 3.11+ gerekli. Mevcut: {v.major}.{v.minor}.{v.micro}")
        print("Indir: https://www.python.org/downloads/")
        sys.exit(1)
    print(f"[OK] Python {v.major}.{v.minor}.{v.micro}")


def create_venv():
    """Sanal ortam olustur"""
    print_step("Sanal ortam (venv)", "-")
    if VENV_DIR.exists():
        print(f"[OK] venv zaten mevcut: {VENV_DIR}")
        return

    print("venv olusturuluyor...")
    result = subprocess.run(
        [sys.executable, "-m", "venv", str(VENV_DIR)],
        capture_output=False, text=True
    )
    if result.returncode != 0:
        print(f"[HATA] venv olusturulamadi: {result.stderr}")
        sys.exit(1)
    print(f"[OK] venv olusturuldu: {VENV_DIR}")


def get_venv_python():
    """venv icindeki python.exe"""
    if platform.system() == "Windows":
        return VENV_DIR / "Scripts" / "python.exe"
    return VENV_DIR / "bin" / "python"


def get_venv_pip():
    """venv icindeki pip"""
    if platform.system() == "Windows":
        return VENV_DIR / "Scripts" / "pip.exe"
    return VENV_DIR / "bin" / "pip"


def install_packages():
    """Tum gerekli paketleri kur"""
    print_step("Paket kurulumu", "-")
    venv_python = str(get_venv_python())
    pip = str(get_venv_pip())

    # SearXNG bagimliliklari (searxng/requirements.txt)
    searxng_deps = [
        "certifi", "babel", "flask-babel", "flask", "jinja2",
        "lxml", "pygments", "python-dateutil", "pyyaml",
        "httpx[http2]", "httpx-socks[asyncio]", "sniffio",
        "valkey", "markdown-it-py", "msgspec", "typer",
        "isodate", "whitenoise", "typing-extensions",
    ]

    packages = [
        ("PyQt6", "Launcher GUI"),
        ("psutil", "Sistem bilgisi"),
        ("huggingface_hub", "Model indirme"),
        ("open-webui", "OpenWebUI (global venv)"),
    ]

    # SearXNG bagimliliklarini ekle
    for dep in searxng_deps:
        packages.append((dep, "SearXNG bagimliligi"))

    # OpenWebUI bagimliliklari (openwebui/backend/requirements-min.txt)
    openwebui_deps = [
        "fastapi", "uvicorn[standard]", "pydantic", "python-multipart",
        "itsdangerous", "python-socketio", "python-jose", "cryptography",
        "bcrypt", "argon2-cffi", "PyJWT[crypto]", "authlib",
        "requests", "aiohttp", "async-timeout", "aiocache", "aiofiles",
        "starlette-compress", "Brotli", "brotlicffi", "httpx[socks,http2,zstd,cli,brotli]",
        "starsessions[redis]", "sqlalchemy", "aiosqlite", "psycopg[binary]",
        "alembic", "peewee", "peewee-migrate", "redis",
        "APScheduler", "RestrictedPython", "loguru", "asgiref",
        "mcp", "openai", "fake-useragent", "chromadb", "pydub", "chardet", "beautifulsoup4",
        "mimeparse", "python-socksio",
    ]

    # OpenWebUI requirements.txt'ten oku
    req_file = ROOT / "openwebui" / "backend" / "requirements.txt"
    if req_file.exists():
        with open(req_file, 'r', encoding='utf-8') as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith('#'):
                    pkg = line.split('==')[0].split('[')[0].split('>')[0].split('<')[0].split(';')[0].strip()
                    if pkg:
                        packages.append((pkg, "OpenWebUI bagimliligi"))

    for pkg, desc in packages:
        print(f"  Installing {pkg} ({desc})...")
        result = subprocess.run(
            [pip, "install", "--trusted-host", "pypi.org", "--trusted-host", "files.pythonhosted.org", pkg],
            capture_output=False, text=True
        )
        if result.returncode == 0:
            print(f"  [OK] {pkg}")
        else:
            print(f"  [UYARI] {pkg} kurulamadi: {result.stderr.strip()[:150]}")


def create_folders():
    """Gerekli klasorleri olustur"""
    print_step("Klasorler", "-")
    folders = [
        ROOT / "models",
        ROOT / "launcher" / "lang",
        PICODING_DIR,
    ]
    for folder in folders:
        folder.mkdir(parents=True, exist_ok=True)
        print(f"[OK] {folder}")


def create_default_config():
    """Varsayilan config.json olustur"""
    print_step("Konfigurasyon", "-")
    if CONFIG_PATH.exists():
        print(f"[OK] config.json zaten mevcut")
        return

    default = {
        "theme": "dark",
        "font_size": 13,
        "picoding_path": str(PICODING_DIR),
        "searxng_port": 8080,
        "openwebui_port": 3000,
        "llamacpp_port": 1234,
        "llamacpp_ctx": 8192,
        "start_with_windows": False,
        "selected_ini": "",
        "vram_gb": 0.0,
        "ram_gb": 0.0,
        "llamacpp_selected_model": "",
    }
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(default, f, indent=2, ensure_ascii=False)
    print(f"[OK] config.json olusturuldu")


def run_helper_scripts():
    """Yardimci scriptleri calistir"""
    print_step("Yardimci scriptler", "-")

    # 1. model_urls.json yoksa olustur
    venv_py = str(get_venv_python())
    
    urls_file = ROOT / "model_urls.json"
    if not urls_file.exists():
        print("  migrate_ini_to_urls.py calistiriliyor...")
        subprocess.run([venv_py, str(ROOT / "migrate_ini_to_urls.py")])

    # 2. INI'leri goreceli path'e cevir
    print("  convert_to_relative.py calistiriliyor...")
    subprocess.run([venv_py, str(ROOT / "convert_to_relative.py")])

    # 3. .bat dosyalarini olustur
    print("  generate_bat_files.py calistiriliyor...")
    subprocess.run([venv_py, str(ROOT / "generate_bat_files.py")])

    # 4. ctx-size kaldir
    print("  remove_ctx_from_ini.py calistiriliyor...")
    subprocess.run([venv_py, str(ROOT / "remove_ctx_from_ini.py")])

    print("[OK] Tum yardimci scriptler tamamlandi")


def setup_picoding_path():
    """Pi Coding icin PATH'e ekle"""
    print_step("Pi Coding PATH", "-")

    if platform.system() != "Windows":
        print("[ATLA] Sadece Windows'ta calisir")
        return

    try:
        import winreg

        # Oku
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Environment",
            0, winreg.KEY_READ
        ) as key:
            try:
                current_path, _ = winreg.QueryValueEx(key, "Path")
            except FileNotFoundError:
                current_path = ""

        picoding_path = str(PICODING_DIR)
        if picoding_path in current_path:
            print(f"[OK] Zaten PATH'te: {picoding_path}")
            return

        new_path = current_path + ";" + picoding_path if current_path else picoding_path

        # Yaz
        with winreg.OpenKey(
            winreg.HKEY_CURRENT_USER,
            r"Environment",
            0, winreg.KEY_SET_VALUE
        ) as key:
            winreg.SetValueEx(key, "Path", 0, winreg.REG_EXPAND_SZ, new_path)

        # Broadcast
        ctypes_run = subprocess.run(
            ["powershell", "-Command", "[Environment]::SetEnvironmentVariable('Path', [Environment]::GetEnvironmentVariable('Path', 'User'), 'User')"],
            capture_output=True
        )

        print(f"[OK] PATH'e eklendi: {picoding_path}")
        print("[NOT] Degisiklik icin yeni terminal ac")
    except Exception as e:
        print(f"[UYARI] PATH duzenlenemedi: {e}")


def check_node():
    """Node.js kontrolu (Pi Coding icin)"""
    print_step("Node.js kontrolu", "-")
    result = subprocess.run(["node", "--version"], capture_output=True, text=True, shell=True)
    if result.returncode == 0:
        print(f"[OK] Node.js {result.stdout.strip()}")
    else:
        print("[UYARI] Node.js bulunamadi. Pi Coding calismaz.")
        print("Indir: https://nodejs.org/")


def create_desktop_shortcut():
    """Masaustu kisayolu — pythonw ile (terminal gizli) + icon"""
    print_step("Masaustu kisayolu", "-")

    if platform.system() != "Windows":
        print("[ATLA] Sadece Windows'ta calisir")
        return

    # pythonw.exe — terminal gizli
    pythonw = VENV_DIR / "Scripts" / "pythonw.exe"
    if not pythonw.exists():
        pythonw = get_venv_python().parent / "pythonw.exe"
    if not pythonw.exists():
        pythonw = get_venv_python()

    main_py = ROOT / "launcher" / "main.py"
    desktop = Path.home() / "Desktop"
    shortcut = desktop / "LLM Runner AIO.lnk"

    # Icon dosyasi (varsa)
    icon_path = ROOT / "assets" / "icon.ico"
    icon_loc = str(icon_path) if icon_path.exists() else f"{pythonw},0"

    try:
        # PowerShell ile kisayol olustur (icon destegi)
        ps_script = f'''
$WshShell = New-Object -comObject WScript.Shell
$Shortcut = $WshShell.CreateShortcut("{shortcut}")
$Shortcut.TargetPath = "{pythonw}"
$Shortcut.Arguments = '"{main_py}"'
$Shortcut.WorkingDirectory = "{ROOT}"
$Shortcut.WindowStyle = 7
$Shortcut.IconLocation = "{icon_loc}"
$Shortcut.Description = "LLM Runner AIO Launcher"
$Shortcut.Save()
'''
        import subprocess as sp
        result = sp.run(
            ["powershell", "-NoProfile", "-Command", ps_script],
            capture_output=True, text=True
        )

        if shortcut.exists():
            print(f"[OK] Kisayol olusturuldu: {shortcut}")
            print(f"     Hedef: {pythonw}")
            print(f"     Icon: {icon_loc}")
        else:
            print(f"[UYARI] Kisayol olusturulamadi: {result.stderr}")
    except Exception as e:
        print(f"[UYARI] Kisayol olusturulamadi: {e}")
        print(f"Manuel olarak calistir: {pythonw} {main_py}")


def main():
    print("=" * 60)
    print("  LLM Runner AIO - Kurulum Sihirbazi")
    print("=" * 60)
    print(f"  Isletim sistemi: {platform.system()} {platform.release()}")
    print(f"  Python: {sys.version}")
    print(f"  Kurulum yeri: {ROOT}")

    check_python()
    create_folders()
    create_venv()
    install_packages()
    create_default_config()
    run_helper_scripts()
    setup_picoding_path()
    check_node()
    create_desktop_shortcut()

    print("\n" + "=" * 60)
    print("  KURULUM TAMAMLANDI!")
    print("=" * 60)
    print(f"\n  Calistirmak icin:")
    print(f"    {VENV_DIR / 'Scripts' / 'activate.bat'}")
    print(f"    python launcher/main.py")
    print(f"\n  Veya masaustundeki 'LLM Runner AIO' kisayoluna tiklayin")
    print("=" * 60)


if __name__ == "__main__":
    main()
