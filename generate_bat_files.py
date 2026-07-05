"""
Her vram*.ini icin baslat_vram*ram*.bat dosyasi olusturur.
bat dosyasi llama-server'i --models-preset ile baslatir.
"""

from pathlib import Path

ROOT = Path(__file__).parent
INI_DIR = ROOT
LLAMA_DIR = ROOT / "llama.cpp-cuda13+vulkan"
LLAMA_EXE = LLAMA_DIR / "llama-server.exe"


def generate_bat(ini_path: Path) -> Path:
    """Bir INI icin .bat dosyasi olustur"""
    # vram6ram32models.ini -> start_vram6ram32.bat
    base_name = ini_path.stem  # vram6ram32models
    bat_name = f"start_{base_name.replace('models', '')}.bat"
    bat_path = INI_DIR / bat_name

    bat_content = f"""@echo off
title llama.cpp ({ini_path.name})
color 0a

echo [Llama.cpp] Baslatiliyor: {ini_path.name}
echo [Config] {ini_path.name}
echo.

cd /d "%~dp0"
"{LLAMA_EXE.relative_to(ROOT)}" ^
  --host 0.0.0.0 ^
  --port 1234 ^
  --models-max 1 ^
  --models-preset "{ini_path.name}" ^
  --jinja

pause
"""
    with open(bat_path, "w", encoding="utf-8") as f:
        f.write(bat_content)
    return bat_path


def main():
    ini_files = sorted(INI_DIR.glob("vram*.ini"))
    for ini_path in ini_files:
        bat_path = generate_bat(ini_path)
        print(f"[OK] {bat_path.name} olusturuldu ({ini_path.name})")
    print(f"\nToplam {len(ini_files)} .bat dosyasi olusturuldu")


if __name__ == "__main__":
    main()
