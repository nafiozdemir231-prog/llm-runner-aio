#!/usr/bin/env python3
"""
sync_pi_config.py
==================
Picoding .pi/config dosyalarını %USERPROFILE%\.pi\agent\ içine sync eder.
command ve args içindeki base-relative path'leri absolute path'e çevirir.

Çalışma zamanı: run.bat ile aynı dizinden çalıştırılmalı.
"""

import json
import os
import shutil
from pathlib import Path


def get_base_dir() -> str:
    """
    Script'in çalıştığı dizini döndür.
    run.bat ile birlikte kullanılırsa %~dp0 (proje kökü) olur.
    """
    return os.getcwd()


def resolve_relative_path(base_dir: str, rel_path: str) -> str:
    """
    Base-relative path'i absolute path'e çevirir.
    
    Örnek:
      base_dir = "D:\\Programlar\\LLM-Runner-AIO"
      rel_path = "venv/Scripts/python.exe"
      → "D:\\Programlar\\LLM-Runner-AIO\\venv\\Scripts\\python.exe"
    """
    # Forward slash'ları backslash'e çevir (cross-platform)
    normalized = rel_path.replace("/", "\\")
    resolved = os.path.join(base_dir, normalized)
    # Normalize et (.. ve . temizle)
    resolved = os.path.normpath(resolved)
    return resolved


def sync_mcp_json(base_dir: str, pi_agent_dir: str) -> bool:
    """
    picoding/.pi/mcp.json → %USERPROFILE%\.pi\agent\mcp.json sync
    
    command ve args içindeki path'leri absolute'ye çevirir.
    """
    src_template = os.path.join(base_dir, "picoding", ".pi", "mcp.json")
    dst = os.path.join(pi_agent_dir, "mcp.json")
    
    if not os.path.exists(src_template):
        print(f"[WARN] Template not found: {src_template}")
        return False
    
    try:
        with open(src_template, "r", encoding="utf-8") as f:
            config = json.load(f)
        
        # command ve args path'lerini absolute'ye çevir
        servers = config.get("mcpServers", {})
        for server_name, server_config in servers.items():
            if isinstance(server_config, dict):
                # command path'ini çevir
                if "command" in server_config:
                    cmd = server_config["command"]
                    if not os.path.isabs(cmd):
                        server_config["command"] = resolve_relative_path(base_dir, cmd)
                
                # args path'lerini çevir
                if "args" in server_config and isinstance(server_config["args"], list):
                    new_args = []
                    for arg in server_config["args"]:
                        if isinstance(arg, str) and not os.path.isabs(arg):
                            new_args.append(resolve_relative_path(base_dir, arg))
                        else:
                            new_args.append(arg)
                    server_config["args"] = new_args
        
        # Hedef dizini oluştur
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        
        # Dosyaya yaz
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        print(f"[OK] mcp.json synced → {dst}")
        return True
        
    except Exception as e:
        print(f"[ERROR] MCP sync failed: {e}")
        return False


def sync_settings_json(base_dir: str, pi_agent_dir: str) -> bool:
    """
    picoding/.pi/settings.json → %USERPROFILE%\.pi\agent\settings.json sync
    """
    src_template = os.path.join(base_dir, "picoding", ".pi", "settings.json")
    dst = os.path.join(pi_agent_dir, "settings.json")
    
    if not os.path.exists(src_template):
        print(f"[WARN] Template not found: {src_template}")
        return False
    
    try:
        with open(src_template, "r", encoding="utf-8") as f:
            config = json.load(f)
        
        # Hedef dizini oluştur
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        
        # Dosyaya yaz (path dönüşümü gerekmez, extensions zaten relative)
        with open(dst, "w", encoding="utf-8") as f:
            json.dump(config, f, indent=2, ensure_ascii=False)
        
        print(f"[OK] settings.json synced → {dst}")
        return True
        
    except Exception as e:
        print(f"[ERROR] Settings sync failed: {e}")
        return False


def sync_agents_md(base_dir: str, pi_agent_dir: str) -> bool:
    """
    picoding/.pi/AGENTS.md → %USERPROFILE%\.pi\agent\AGENTS.md sync
    """
    src_template = os.path.join(base_dir, "picoding", ".pi", "AGENTS.md")
    dst = os.path.join(pi_agent_dir, "AGENTS.md")
    
    if not os.path.exists(src_template):
        print(f"[WARN] AGENTS.md template not found: {src_template}")
        return False
    
    try:
        # Hedef dizini oluştur
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        
        # Dosyayı kopyala (metin dosyası, path dönüşümü gerekmez)
        shutil.copy2(src_template, dst)
        
        print(f"[OK] AGENTS.md synced → {dst}")
        return True
        
    except Exception as e:
        print(f"[ERROR] AGENTS.md sync failed: {e}")
        return False


def sync_extensions_auto_model_discovery(base_dir: str, pi_agent_dir: str) -> bool:
    """
    picoding/.pi/extensions/auto-model-discovery.ts → %USERPROFILE%\.pi\agent\extensions\auto-model-discovery.ts sync
    """
    src_template = os.path.join(base_dir, "picoding", ".pi", "extensions", "auto-model-discovery.ts")
    dst = os.path.join(pi_agent_dir, "extensions", "auto-model-discovery.ts")
    
    if not os.path.exists(src_template):
        print(f"[WARN] auto-model-discovery.ts template not found: {src_template}")
        return False
    
    try:
        # Hedef dizini oluştur
        os.makedirs(os.path.dirname(dst), exist_ok=True)
        
        # Dosyayı kopyala
        shutil.copy2(src_template, dst)
        
        print(f"[OK] auto-model-discovery.ts synced → {dst}")
        return True
        
    except Exception as e:
        print(f"[ERROR] auto-model-discovery.ts sync failed: {e}")
        return False


def main():
    base_dir = get_base_dir()
    pi_agent_dir = os.path.join(
        os.environ.get("USERPROFILE", ""), ".pi", "agent"
    )
    
    print("=" * 60)
    print("  Syncing Pi Configuration Files")
    print("=" * 60)
    print(f"  Base directory: {base_dir}")
    print(f"  Target dir:     {pi_agent_dir}")
    print("-" * 60)
    
    mcp_ok = sync_mcp_json(base_dir, pi_agent_dir)
    settings_ok = sync_settings_json(base_dir, pi_agent_dir)
    agents_ok = sync_agents_md(base_dir, pi_agent_dir)
    ext_ok = sync_extensions_auto_model_discovery(base_dir, pi_agent_dir)
    
    if mcp_ok and settings_ok and agents_ok and ext_ok:
        print("-" * 60)
        print("[SUCCESS] All config files synced!")
        print("=" * 60)
    else:
        print("-" * 60)
        print("[WARNING] Some configs failed to sync.")
        print("=" * 60)
        exit(1)


if __name__ == "__main__":
    main()
