"""
Mevcut INI dosyalarindaki mutlak path'leri goreceli path'e cevirir.
D:\OpenCode\Llm-Runner-aio\models\... -> models/...
"""

import configparser
from pathlib import Path

ROOT = Path(__file__).parent
INI_DIR = ROOT


def to_relative(absolute_path: str) -> str:
    """Mutlak path'i goreceli path'e cevir"""
    if not absolute_path:
        return absolute_path
    p = Path(absolute_path)
    try:
        # ROOT'a goreceli hale getir
        rel = p.relative_to(ROOT)
        # Windows path separator -> slash
        return str(rel).replace("\\", "/")
    except ValueError:
        # ROOT altinda degilse oldugu gibi don
        return absolute_path


def convert_ini(ini_path: Path):
    """Bir INI dosyasini guncelle"""
    config = configparser.ConfigParser()
    config.read(ini_path, encoding="utf-8")

    changed = False
    for section in config.sections():
        for key in ("model", "mmproj"):
            val = config[section].get(key, "")
            if val and (val.startswith("http") or "/" in val or "\\" in val):
                new_val = to_relative(val)
                if new_val != val:
                    config[section][key] = new_val
                    changed = True

    if changed:
        with open(ini_path, "w", encoding="utf-8") as f:
            config.write(f)
        print(f"[OK] {ini_path.name} guncellendi")
    else:
        print(f"[SKIP] {ini_path.name} zaten goreceli")


def main():
    ini_files = sorted(INI_DIR.glob("vram*.ini"))
    for ini_path in ini_files:
        convert_ini(ini_path)
    print(f"\nToplam {len(ini_files)} INIs kontrol edildi")


if __name__ == "__main__":
    main()
