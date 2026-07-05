"""
Mevcut INI dosyalarından URL'leri cikarip model_urls.json olusturur
ve INI dosyalarini yerel path'lere cevirir.
"""

import configparser
import json
from pathlib import Path

ROOT = Path(__file__).parent
INI_DIR = ROOT
URLS_JSON = ROOT / "model_urls.json"
MODELS_DIR = ROOT / "models"


def url_to_local_path(url: str, section_name: str) -> str:
    """URL'i GORECELI yerel dosya yoluna cevir (tasinabilir)"""
    if not url or not url.startswith("http"):
        return url

    filename = url.split("/")[-1]
    folder_name = section_name.replace("-vision", "").replace("-Vision", "")
    # Goreceli path kullan — tasinabilir
    return f"models/{folder_name}/{filename}"


def migrate_ini_files():
    """Tum vram*.ini dosyalarini tara, URL'leri cikar, model_urls.json olustur"""
    if URLS_JSON.exists():
        print(f"[SKIP] {URLS_JSON.name} zaten mevcut")
        return

    all_urls = {}
    ini_files = sorted(INI_DIR.glob("vram*.ini"))

    for ini_path in ini_files:
        config = configparser.ConfigParser()
        config.read(ini_path, encoding="utf-8")

        ini_name = ini_path.name
        all_urls[ini_name] = {}

        for section in config.sections():
            if section == "*":
                continue

            model_url = config[section].get("model", "")
            mmproj_url = config[section].get("mmproj", "")

            if not model_url and not mmproj_url:
                continue

            entry = {}
            if model_url:
                entry["model"] = model_url
            if mmproj_url:
                entry["mmproj"] = mmproj_url

            all_urls[ini_name][section] = entry

            # INI'deki URL'leri yerel path'e cevir
            if model_url:
                config[section]["model"] = url_to_local_path(model_url, section)
            if mmproj_url:
                config[section]["mmproj"] = url_to_local_path(mmproj_url, section)

        # INI dosyasini guncelle
        with open(ini_path, "w", encoding="utf-8") as f:
            config.write(f)

        print(f"[OK] {ini_name} guncellendi ({len(all_urls[ini_name])} model)")

    # model_urls.json yaz
    with open(URLS_JSON, "w", encoding="utf-8") as f:
        json.dump(all_urls, f, indent=2, ensure_ascii=False)

    print(f"\n[OK] {URLS_JSON.name} olusturuldu")
    print(f"     Toplam INI: {len(ini_files)}")
    total_models = sum(len(v) for v in all_urls.values())
    print(f"     Toplam model: {total_models}")


if __name__ == "__main__":
    migrate_ini_files()
