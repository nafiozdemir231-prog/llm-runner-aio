"""
Tum vram*.ini dosyalarindan global ctx-size satirini kaldir.
Bunu launcher yonetir, INI'de olmamali.
"""

import configparser
from pathlib import Path

ROOT = Path(__file__).parent
INI_DIR = ROOT


def remove_ctx_from_ini(ini_path: Path):
    config = configparser.ConfigParser()
    config.read(ini_path, encoding="utf-8")

    changed = False
    if "*" in config.sections():
        if config["*"].get("ctx-size"):
            del config["*"]["ctx-size"]
            changed = True

    # Section'lardaki ctx-size'i da kaldir (varsa)
    for section in config.sections():
        if config[section].get("ctx-size") and section != "*":
            del config[section]["ctx-size"]
            changed = True

    if changed:
        with open(ini_path, "w", encoding="utf-8") as f:
            config.write(f)
        print(f"[OK] {ini_path.name} -> ctx-size kaldirildi")
    else:
        print(f"[SKIP] {ini_path.name} zaten temiz")


def main():
    ini_files = sorted(INI_DIR.glob("vram*.ini"))
    for ini_path in ini_files:
        remove_ctx_from_ini(ini_path)
    print(f"\nToplam {len(ini_files)} INI islendi")


if __name__ == "__main__":
    main()
