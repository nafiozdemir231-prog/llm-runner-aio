"""
OpenWebUI fonksiyonlarını veritabanına import eder.
function/ klasöründeki JSON dosyalarını OpenWebUI veritabanına ekler.
"""
import json
import sys
import os
import time
import sqlite3
from pathlib import Path

# UTF-8 stdout/stderr
for stream in (sys.stdout, sys.stderr):
    if hasattr(stream, 'buffer'):
        stream.reconfigure(encoding='utf-8')

# OpenWebUI backend dizinini PYTHONPATH'e ekle
backend_dir = Path(__file__).parent / "openwebui" / "backend"
sys.path.insert(0, str(backend_dir))

# Veritabanı yolunu bul — database/ dizinine kaydediliyor
db_path = None
database_dir = Path(__file__).parent / "openwebui" / "database"
for candidate in [
    database_dir / "webui.db",
    backend_dir.parent / "openwebui.db",
    backend_dir / "openwebui.db",
]:
    if candidate.exists():
        db_path = candidate
        break

if not db_path or not db_path.exists():
    print("[INFO] Veritabanı bulunamadı — OpenWebUI henüz başlatılmamış olabilir.")
    sys.exit(0)

print(f"[INFO] Veritabanı: {db_path}")

# function/ klasörünü bul
function_dir = Path(__file__).parent / "openwebui" / "function"
if not function_dir.exists():
    print(f"[ERROR] function/ klasörü bulunamadı: {function_dir}")
    sys.exit(1)

# JSON dosyalarını yükle
json_files = sorted(function_dir.glob("*.json"))
if not json_files:
    print("[INFO] function/ klasöründe JSON dosyası yok.")
    sys.exit(0)

print(f"[INFO] {len(json_files)} fonksiyon dosyası bulundu.")

# Veritabanını aç
conn = sqlite3.connect(str(db_path))
cursor = conn.cursor()

# function tablosu var mı kontrol et
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='function';")
if not cursor.fetchone():
    print("[INFO] function tablosu henüz oluşturulmamış.")
    conn.close()
    sys.exit(0)

# tool tablosu var mı kontrol et
cursor.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='tool';")
has_tool_table = bool(cursor.fetchone())

# Admin user_id'sini bul
admin_user_id = None
cursor.execute("SELECT id FROM user WHERE role = 'admin' LIMIT 1")
row = cursor.fetchone()
if row:
    admin_user_id = row[0]
    print(f"[INFO] Admin user_id: {admin_user_id}")
else:
    print("[WARNING] Admin kullanıcı bulunamadı — fonksiyonlar user_id='' ile kaydedilecek.")

# Her JSON dosyasını işle
functions_added = 0
functions_updated = 0
tools_added = 0
tools_updated = 0

for json_file in json_files:
    try:
        with open(json_file, encoding='utf-8-sig') as f:
            data = json.load(f)

        if not isinstance(data, list) or len(data) == 0:
            continue

        item = data[0]
        item_id = item.get('id')
        name = item.get('name', 'Unknown')
        item_type = item.get('type')  # action, filter, pipe, tool, None

        # Function type (action, filter, pipe) -> function tablosu
        if item_type in ('action', 'filter', 'pipe'):
            func_type = item_type
            content = item.get('content', '')
            meta = json.dumps(item.get('meta', {}))
            # Boş user_id varsa admin ile değiştir
            user_id = item.get('user_id', '')
            if not user_id and admin_user_id:
                user_id = admin_user_id
            is_active = item.get('is_active', True)
            is_global = item.get('is_global', False)
            valves = json.dumps(item.get('valves', None))
            created_at = item.get('created_at', int(time.time()))
            updated_at = item.get('updated_at', int(time.time()))

            cursor.execute("SELECT id FROM function WHERE id = ?", (item_id,))
            exists = cursor.fetchone()

            if exists:
                cursor.execute("""
                    UPDATE function
                    SET name=?, type=?, content=?, meta=?, user_id=?,
                        is_active=?, is_global=?, valves=?, updated_at=?
                    WHERE id = ?
                """, (
                    name, func_type, content, meta, user_id,
                    is_active, is_global, valves, int(time.time()),
                    item_id
                ))
                functions_updated += 1
                print(f"  [OK] Güncellendi (function): {name}")
            else:
                cursor.execute("""
                    INSERT INTO function
                    (id, user_id, name, type, content, meta, valves, created_at, updated_at, is_active, is_global)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    item_id, user_id, name, func_type, content, meta, valves,
                    created_at, int(time.time()), is_active, is_global
                ))
                functions_added += 1
                print(f"  [OK] Eklendi (function): {name}")

        # Tool type -> tool tablosu
        elif item_type is None or item_type == 'tool':
            if not has_tool_table:
                continue

            tool_id = item.get('id')
            tool_name = item.get('name', 'Unknown')
            content = item.get('content', '')
            specs = json.dumps(item.get('specs', []))
            meta = json.dumps(item.get('meta', {}))
            # Boş user_id varsa admin ile değiştir
            user_id = item.get('user_id', '')
            if not user_id and admin_user_id:
                user_id = admin_user_id
            created_at = item.get('created_at', int(time.time()))
            updated_at = item.get('updated_at', int(time.time()))
            valves = json.dumps(item.get('valves', None))

            cursor.execute("SELECT id FROM tool WHERE id = ?", (tool_id,))
            exists = cursor.fetchone()

            if exists:
                cursor.execute("""
                    UPDATE tool
                    SET name=?, content=?, specs=?, meta=?, user_id=?,
                        valves=?, updated_at=?
                    WHERE id = ?
                """, (
                    tool_name, content, specs, meta, user_id,
                    valves, int(time.time()),
                    tool_id
                ))
                tools_updated += 1
                print(f"  [OK] Güncellendi (tool): {tool_name}")
            else:
                cursor.execute("""
                    INSERT INTO tool
                    (id, user_id, name, content, specs, meta, valves, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    tool_id, user_id, tool_name, content, specs, meta, valves,
                    created_at, int(time.time())
                ))
                tools_added += 1
                print(f"  [OK] Eklendi (tool): {tool_name}")

    except Exception as e:
        print(f"  [ERROR] ({json_file.name}): {e}")

conn.commit()
conn.close()

print(f"\n[OK] Fonksiyonlar: {functions_added} eklendi, {functions_updated} güncellendi")
print(f"[OK] Araçlar: {tools_added} eklendi, {tools_updated} güncellendi")
