"""
OpenWebUI fonksiyonlarını API üzerinden import eder.
function/ klasöründeki JSON dosyalarını OpenWebUI API'sine gönderir.
"""
import json
import sys
import time
import requests
from pathlib import Path

# function/ klasörünü bul
function_dir = Path(__file__).parent / "openwebui" / "function"
if not function_dir.exists():
    print(f"[ERROR] function/ klasörü bulunamadı")
    sys.exit(1)

# JSON dosyalarını yükle
json_files = sorted(function_dir.glob("*.json"))
if not json_files:
    print("[INFO] function/ klasöründe JSON dosyası yok.")
    sys.exit(0)

print(f"[INFO] {len(json_files)} fonksiyon dosyası bulundu.")

# OpenWebUI API URL'si
api_url = "http://localhost:3000/api/v1/functions/sync"

# Her JSON dosyasını API'ye gönder
success = 0
errors = 0

for json_file in json_files:
    try:
        with open(json_file, encoding='utf-8-sig') as f:
            data = json.load(f)

        if not isinstance(data, list) or len(data) == 0:
            continue

        item = data[0]
        func_type = item.get('type')

        # Sadece function type'ları işle (action, filter, pipe)
        if func_type not in ('action', 'filter', 'pipe'):
            print(f"  [SKIP] {item.get('name')} ({func_type} - tool)")
            continue

        # Sync endpoint'e gönder
        try:
            response = requests.post(api_url, json=data, timeout=10)
            if response.status_code == 200:
                result = response.json()
                if isinstance(result, list):
                    print(f"  [OK] Sync: {item.get('name')}")
                    success += 1
                else:
                    print(f"  [WARN] Sync response unexpected: {item.get('name')}")
            else:
                print(f"  [ERROR] HTTP {response.status_code}: {item.get('name')}")
                errors += 1
        except requests.exceptions.ConnectionError:
            print(f"  [ERROR] Connection refused: {item.get('name')}")
            print(f"         OpenWebUI henüz hazır değil. Manuel çalıştırın: python import_functions_api.py")
            errors += 1
        except Exception as e:
            print(f"  [ERROR] {item.get('name')}: {e}")
            errors += 1

    except Exception as e:
        print(f"  [ERROR] ({json_file.name}): {e}")
        errors += 1

print(f"\n[OK] {success} fonksiyon sync edildi, {errors} hata")
