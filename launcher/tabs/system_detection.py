"""
LLM Runner AIO - Tab 1: System Detection
Donanım tespiti, INI seçimi, model indirme
"""

import subprocess
import threading
import configparser
import os
import re
import json
import hashlib
from pathlib import Path

from PyQt6.QtWidgets import (
    QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QComboBox, QProgressBar, QListWidget, QListWidgetItem,
    QGroupBox, QTextEdit, QScrollArea, QWidget, QMessageBox,
    QFileDialog, QLineEdit, QSplitter
)
from PyQt6.QtCore import Qt, QThread, pyqtSignal
from PyQt6.QtGui import QFont

from app import ROOT, AppManager

# INI ve BAT dosyalarının yolu — ROOT dizininde
# INI dosyalari: gpu*.ini formatinda (gpu1vram4ram16models.ini, gpu1vram8ram32models.ini, ...)
# BAT dosyalari: start_gpu*.bat formatinda (start_gpu1vram4ram16.bat, ...)
INI_DIR = ROOT
BAT_DIR = ROOT


def _calculate_sha256(file_path: Path) -> str:
    """Dosyanın SHA256 hash'ini hesapla"""
    sha256_hash = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(8192), b""):
            sha256_hash.update(chunk)
    return sha256_hash.hexdigest()


def _cleanup_partial_files(folder: Path, filename: str) -> None:
    """Bug #3: Disk dolunca kalan .part dosyalarını temizle"""
    try:
        for partial in folder.glob("*.part"):
            if partial.name.startswith(filename.split('.')[0]):
                partial.unlink()
                print(f"[CLEANUP] Removed partial file: {partial}")
    except Exception as e:
        print(f"[CLEANUP] Error cleaning partial files: {e}")


class DownloadThread(QThread):
    """HuggingFace model indirme thread"""
    progress = pyqtSignal(str, int, int)  # name, downloaded, total
    finished = pyqtSignal(str, str)  # name, folder_path

    def __init__(self, url, dest_folder, model_name):
        super().__init__()
        self.url = url
        self.dest_folder = dest_folder
        self.model_name = model_name
        self._cancelled = False

    def run(self):
        from huggingface_hub import hf_hub_download

        # URL'den repo_id ve filename çıkar
        url = self.url
        if "/resolve/" in url:
            url_part = url.split("/resolve/")[0]
            repo_id = url_part.replace("https://huggingface.co/", "")
        else:
            repo_id = url
        filename = self.url.split("/")[-1]

        try:
            # İndir
            hf_hub_download(
                repo_id=repo_id,
                filename=filename,
                local_dir=str(self.dest_folder),
            )

            # Bug #5: SHA256 doğrulama (opsiyonel - hash yoksa atla)
            expected_hash = self._get_expected_hash(filename)
            if expected_hash:
                file_path = self.dest_folder / filename
                actual_hash = _calculate_sha256(file_path)
                if actual_hash != expected_hash:
                    self.finished.emit(
                        self.model_name,
                        f"Error: Hash mismatch for {filename}. Expected {expected_hash[:16]}..., got {actual_hash[:16]}..."
                    )
                    return

            self.finished.emit(self.model_name, str(self.dest_folder))

        except Exception as e:
            # Bug #3: Disk dolunca partial dosyaları temizle
            _cleanup_partial_files(self.dest_folder, filename)
            if str(e) != "Cancelled":
                self.finished.emit(self.model_name, f"Error: {e}")

    def _get_expected_hash(self, filename: str) -> str:
        """model_urls.json'dan beklenen SHA256 hash'i al"""
        urls_json = ROOT / "model_urls.json"
        if not urls_json.exists():
            return ""

        try:
            with open(urls_json, "r", encoding="utf-8") as f:
                all_data = json.load(f)

            # Tüm JSON içinde filename'ı ara ve hash'i bul
            for section_key, sections in all_data.items():
                if isinstance(sections, dict):
                    for model_name, model_data in sections.items():
                        if isinstance(model_data, dict):
                            if model_data.get("model", "").endswith(filename):
                                return model_data.get("sha256", "")
                            if model_data.get("mmproj", "").endswith(filename):
                                return model_data.get("sha256_mmproj", "")
        except Exception:
            pass
        return ""

    def cancel(self):
        self._cancelled = True


class SystemDetectionTab(QWidget):
    """Tab 1: Sistem tespiti ve model yönetimi"""

    def __init__(self):
        super().__init__()
        self._manager = AppManager()
        self._lang = self._manager.lang
        self._config = self._manager.config
        self._selected_ini = ""
        self._models = []
        self._download_threads = []

        self._init_ui()
        self._load_saved_ini()

    def _load_saved_ini(self):
        """Config'den kayitli INI'yi yukle"""
        saved_ini = self._config.get("selected_ini", "")
        if saved_ini and (INI_DIR / saved_ini).exists():
            self._selected_ini = saved_ini
            self.ini_combo.setCurrentText(saved_ini)
            self.ini_info_label.setText(
                self._lang.get("label_selected_ini", "Config: {file}").format(file=saved_ini)
            )
            self._load_ini_models()
            self._create_local_ini()
            self.auto_log.append(f"[OK] Saved INI loaded: {saved_ini}")
        else:
            self.auto_log.append("[INFO] No saved INI — run 'Detect Hardware' first")

    def _init_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)

        # === DONANIM TESPİT ===
        detect_layout = QHBoxLayout()
        self.detect_btn = QPushButton(self._lang.get("btn_detect", "Detect Hardware"))
        self.detect_btn.setMinimumHeight(40)
        self.detect_btn.clicked.connect(self._detect_hardware)
        detect_layout.addWidget(self.detect_btn)
        detect_layout.addStretch()
        layout.addLayout(detect_layout)

        # Donanım bilgisi
        hw_group = QGroupBox(self._lang.get("label_settings", "Settings"))
        hw_layout = QVBoxLayout()

        self.gpu_label = QLabel("")
        self.gpu_label.setStyleSheet("font-size: 14px; font-weight: bold;")
        hw_layout.addWidget(self.gpu_label)

        self.vram_label = QLabel("")
        hw_layout.addWidget(self.vram_label)

        self.ram_label = QLabel("")
        hw_layout.addWidget(self.ram_label)

        self.ini_label = QLabel("")
        self.ini_label.setStyleSheet("color: palette(text-muted); font-size: 13px;")
        # Donanim grubunda bilgiyi gosterme — sadece ayrı grup var
        # hw_layout.addWidget(self.ini_label)

        hw_group.setLayout(hw_layout)
        layout.addWidget(hw_group)

        # === INI BİLGİSİ (görsel) ===
        ini_group = QGroupBox(self._lang.get("label_models_ini", "Models Configuration"))
        ini_layout = QVBoxLayout()

        # INI seçimi — otomatik + manuel secim
        ini_top_layout = QHBoxLayout()
        ini_top_layout.addWidget(QLabel(self._lang.get("label_ini_select", "Select INI:")))

        ini_files = sorted([f for f in INI_DIR.glob("gpu*.ini")])
        self.ini_combo = QComboBox()
        for ini in ini_files:
            self.ini_combo.addItem(ini.name)
        self.ini_combo.currentTextChanged.connect(self._on_ini_changed)
        ini_top_layout.addWidget(self.ini_combo)
        ini_top_layout.addStretch()

        # Otomatik secim butonu
        self.auto_select_btn = QPushButton(self._lang.get("btn_auto_select", "Auto Select"))
        self.auto_select_btn.clicked.connect(self._detect_hardware)
        ini_top_layout.addWidget(self.auto_select_btn)

        ini_layout.addLayout(ini_top_layout)

        # Bilgi label
        self.ini_info_label = QLabel(self._lang.get("msg_ini_auto", "(Run Detect Hardware to auto-select)"))
        self.ini_info_label.setStyleSheet("color: palette(text-muted); font-style: italic;")
        ini_layout.addWidget(self.ini_info_label)

        ini_group.setLayout(ini_layout)
        layout.addWidget(ini_group)

        # === MODEL İNDEKS LİSTESİ ===
        model_list_group = QGroupBox(self._lang.get("label_download", "Download Models"))
        model_list_layout = QVBoxLayout()

        # Üst butonlar
        btn_layout = QHBoxLayout()
        self.download_all_btn = QPushButton(self._lang.get("btn_download_all", "Download All Models"))
        self.download_all_btn.clicked.connect(self._download_all)
        btn_layout.addWidget(self.download_all_btn)
        btn_layout.addStretch()
        model_list_layout.addLayout(btn_layout)

        self.model_list = QListWidget()
        self.model_list.setSelectionMode(QListWidget.SelectionMode.MultiSelection)
        model_list_layout.addWidget(self.model_list)

        model_list_group.setLayout(model_list_layout)
        layout.addWidget(model_list_group, 1)

        # === İNME DURUMU ===
        progress_group = QGroupBox(self._lang.get("label_download_progress", "Download Progress"))
        progress_layout = QVBoxLayout()

        self.download_status = QLabel("")
        self.download_status.setStyleSheet("font-size: 13px;")
        progress_layout.addWidget(self.download_status)

        progress_group.setLayout(progress_layout)
        layout.addWidget(progress_group)

        # === START AUTO BAT ===
        auto_group = QGroupBox(self._lang.get("label_start_auto", "Start Configuration"))
        auto_layout = QVBoxLayout()
        auto_layout.addWidget(QLabel(self._lang.get("label_auto_config", "Auto-generated start_auto.bat after download")))

        self.auto_log = QTextEdit()
        self.auto_log.setReadOnly(True)
        self.auto_log.setMaximumHeight(100)
        auto_layout.addWidget(self.auto_log)

        auto_group.setLayout(auto_layout)
        layout.addWidget(auto_group)

        self.setLayout(layout)

        # INI arka planda — UI'da gosterilmez
        # Gercek secim Detect Hardware veya _load_saved_ini ile yapilacak

    def _detect_hardware(self):
        """Donanım tespiti: GPU, VRAM, RAM"""
        gpu_name = "N/A"
        vram_gb = 0
        ram_gb = 0
        gpu_vendor = "none"  # nvidia, amd, intel, none

        # NVIDIA GPU tespiti
        try:
            result = subprocess.run(
                ["nvidia-smi", "--query-gpu=name,memory.total", "--format=csv,noheader,nounits"],
                capture_output=True, text=True, timeout=10
            )
            if result.returncode == 0 and result.stdout.strip():
                lines = result.stdout.strip().split("\n")
                first = lines[0].split(",")
                gpu_name = first[0].strip()
                vram_gb = float(first[1].strip()) / 1024.0  # MB -> GB
                gpu_vendor = "nvidia"
        except Exception:
            pass

        # AMD/Intel GPU tespiti (NVIDIA yoksa)
        if vram_gb == 0:
            try:
                # PowerShell ile basit GPU bilgisi al
                result = subprocess.run(
                    ["powershell", "-NoProfile", "-Command",
                     "Get-WmiObject Win32_VideoController | Select-Object Name, AdapterRAM | ConvertTo-Json"],
                    capture_output=True, text=True, timeout=10, shell=True
                )
                if result.returncode == 0 and result.stdout.strip():
                    import json as _json
                    try:
                        gpus = _json.loads(result.stdout)
                        if isinstance(gpus, dict):
                            gpus = [gpus]
                        for gpu in gpus:
                            name = gpu.get("Name", "")
                            ram = gpu.get("AdapterRAM", 0)
                            if name and ("AMD" in name or "Radeon" in name or "Intel" in name):
                                gpu_name = name
                                if ram and isinstance(ram, (int, float)):
                                    vram_gb = ram / (1024 ** 3)
                                if "AMD" in name or "Radeon" in name:
                                    gpu_vendor = "amd"
                                elif "Intel" in name:
                                    gpu_vendor = "intel"
                                break
                    except _json.JSONDecodeError:
                        pass
            except Exception:
                pass

        # RAM tespiti
        try:
            import psutil
            total_ram = psutil.virtual_memory().total
            ram_gb = total_ram / (1024 ** 3)
        except Exception:
            # psutil yoksa fallback
            try:
                import ctypes
                kernel32 = ctypes.windll.kernel32
                global_mem_status = ctypes.c_ulonglong(0)
                kernel32.GetPhysicallyInstalledSystemMemory(ctypes.byref(global_mem_status))
                ram_gb = global_mem_status.value / (1024 ** 3)
            except Exception:
                ram_gb = 0

        if vram_gb == 0:
            self.gpu_label.setText(self._lang.get("msg_no_gpu", "No NVIDIA GPU detected. CPU-only mode."))
        else:
            self.gpu_label.setText(self._lang.get("label_gpu", "GPU: {name}").format(name=gpu_name))

        self.vram_label.setText(self._lang.get("label_vram", "VRAM: {v} GB").format(v=vram_gb))
        self.ram_label.setText(self._lang.get("label_ram", "RAM: {r} GB").format(r=round(ram_gb, 1)))

        # INI dosyasını seç
        self._select_ini(vram_gb, ram_gb)

        # AMD/Intel icin elle secim (NVIDIA degilse)
        if gpu_vendor in ("amd", "intel") or vram_gb == 0:
            # Combo'yu goster — kullanici kendi seçsin
            self.ini_combo.setVisible(True)
            self.ini_info_label.setText(
                self._lang.get("msg_select_ini_manual", "Select your INI manually (AMD/Intel detected)")
            )
        else:
            self.ini_combo.setVisible(False)

        # Config'e kaydet — kalici olsun
        self._config.set("vram_gb", round(vram_gb, 2))
        self._config.set("ram_gb", round(ram_gb, 2))
        self._config.set("selected_ini", self._selected_ini)

    def _select_ini(self, vram_gb, ram_gb):
        """VRAM ve RAM'e göre INI dosyası seç"""
        # VRAM tier seçimi — mevcut tier degerlerine göre
        if vram_gb < 4.5:
            vram_tier = 4
        elif vram_gb <= 7.5:
            vram_tier = 6
        elif vram_gb <= 10:
            vram_tier = 8
        elif vram_gb <= 14:
            vram_tier = 12
        elif vram_gb <= 20:
            vram_tier = 16
        elif vram_gb <= 28:
            vram_tier = 24
        else:
            vram_tier = 32

        # RAM tier seçimi — basit 16/32 (dosya adlarindaki tier degerleri)
        if ram_gb < 17:
            ram_tier = 16
        else:
            ram_tier = 32

        # Mevcut INI dosyalarını tara ve en uygun olanı bul
        existing_inis = [f.name for f in INI_DIR.glob("gpu*.ini")]
        
        # Tam eşleşme dene — gpu{gpu}vram{vram}ram{ram}models.ini formati
        ini_name = f"gpu1vram{vram_tier}ram{ram_tier}models.ini"
        if ini_name in existing_inis:
            self._selected_ini = ini_name
        else:
            # En yakın VRAM ve RAM'e sahip INI'yi bul
            best_match = None
            best_score = float('inf')
            
            for ini_file in existing_inis:
                # gpu{gpu}vram{X}ram{Y}models.ini veya gpu{gpu}vram{X-Y}ram{Y-Z}models.ini formatini parse et
                try:
                    # Hem duz hem aralik formatini destekle
                    match = re.search(r'gpu\d+vram(\d+(?:-\d+)?)ram(\d+(?:-\d+)?)models\.ini', ini_file)
                    if not match:
                        continue
                    
                    # vram degerini al (aralik ise ust sinir)
                    vram_str = match.group(1)
                    if '-' in vram_str:
                        min_vram = int(vram_str.split('-')[0])
                    else:
                        min_vram = int(vram_str)
                    
                    # ram degerini al
                    ram_str = match.group(2)
                    if '-' in ram_str:
                        min_ram = int(ram_str.split('-')[0])
                    else:
                        min_ram = int(ram_str)
                    
                    # Skor: VRAM farkı * 2 (VRAM onemli) + RAM farkı
                    vram_diff = abs(min_vram - vram_tier)
                    ram_diff = abs(min_ram - ram_tier)
                    score = vram_diff * 2 + ram_diff
                    
                    if score < best_score:
                        best_score = score
                        best_match = ini_file
                except (ValueError, IndexError):
                    continue
            
            if best_match:
                self._selected_ini = best_match
            else:
                self._selected_ini = existing_inis[0] if existing_inis else ""

        self.ini_combo.setCurrentText(self._selected_ini)
        self.ini_info_label.setText(
            self._lang.get("label_selected_ini", "Config: {file}").format(file=self._selected_ini)
        )

        self._load_ini_models()
        self._create_local_ini()

    def _on_ini_changed(self, ini_name):
        # Placeholder kontrolu
        if ini_name.startswith("--") or not ini_name:
            self._selected_ini = ""
        else:
            self._selected_ini = ini_name
        if self._selected_ini:
            self.ini_info_label.setText(
                self._lang.get("label_selected_ini", "Config: {file}").format(file=ini_name)
            )
            self._load_ini_models()
            self._create_local_ini()

    def _load_ini_models(self):
        """INI dosyasını oku, model listesini doldur"""
        self.model_list.clear()
        self._models = []

        if not self._selected_ini:
            return

        ini_path = INI_DIR / self._selected_ini
        if not ini_path.exists():
            return

        config = configparser.ConfigParser()
        config.read(ini_path, encoding="utf-8")

        for section in config.sections():
            if section == "*":
                continue

            model_info = {
                "name": section,
                "model_url": config[section].get("model", ""),
                "mmproj_url": config[section].get("mmproj", ""),
            }
            self._models.append(model_info)

            # Model adını listeye ekle
            item_text = f"[{section}]"
            item = QListWidgetItem(item_text)
            item.setData(Qt.ItemDataRole.UserRole, model_info)
            self.model_list.addItem(item)
        
        # Secili INI'ya ozel yerel INI oluştur
        self._create_local_ini()

    def _create_local_ini(self):
        """Secili INI'ya ozel yerel INI oluştur — URL'leri yerel dosya yollarina cevir"""
        if not self._selected_ini:
            return
        
        # Secili INI isminden yerel INI adi oluştur: gpu1vram4ram16models.ini -> models_gpu1vram4ram16.ini
        base_name = self._selected_ini.replace("models.ini", "").replace(".ini", "")
        local_ini_path = ROOT / f"models_{base_name}.ini"
        local_config = configparser.ConfigParser()
        
        for model in self._models:
            section = model["name"]
            model_url = model.get("model_url", "")
            mmproj_url = model.get("mmproj_url", "")

            # URL'yi GORECELI yerel dosya yoluna cevir (tasinabilir)
            local_model = model_url
            local_mmproj = mmproj_url

            if model_url.startswith("http"):
                filename = model_url.split("/")[-1]
                folder_name = section.replace("-vision", "").replace("-Vision", "")
                local_model = f"models/{folder_name}/{filename}"

            if mmproj_url.startswith("http"):
                filename = mmproj_url.split("/")[-1]
                folder_name = section.replace("-vision", "").replace("-Vision", "")
                local_mmproj = f"models/{folder_name}/{filename}"
            
            local_config[section] = {}
            if local_model != model_url:
                local_config[section]["model"] = local_model
            elif model_url:
                local_config[section]["model"] = model_url
            if local_mmproj != mmproj_url:
                local_config[section]["mmproj"] = local_mmproj
            elif mmproj_url:
                local_config[section]["mmproj"] = mmproj_url
        
        with open(local_ini_path, "w", encoding="utf-8") as f:
            local_config.write(f)
        
        self.auto_log.append(f"[OK] {local_ini_path.name} created with {len(local_config.sections())} sections")

    def _download_model(self, model_info):
        """Tek model indir — model_urls.json'dan URL alir"""
        print(f"[DEBUG] _download_model called for: {model_info['name']}")
        models_dir = ROOT / "models"

        # Section adindan klasor ismi cikar
        folder_name = model_info["name"].replace("-vision", "").replace("-Vision", "")
        model_folder = models_dir / folder_name
        model_folder.mkdir(parents=True, exist_ok=True)

        # URL'leri model_urls.json'dan al
        urls = self._get_urls_from_json(self._selected_ini, model_info["name"])
        print(f"[DEBUG] urls for {model_info['name']}: model={urls['model'][:50] if urls['model'] else 'EMPTY'}, mmproj={urls['mmproj'][:50] if urls['mmproj'] else 'EMPTY'}")

        # Ana model
        if urls["model"]:
            self.download_status.setText(f"Downloading {model_info['name']}...")

            thread = DownloadThread(
                urls["model"],
                model_folder,
                model_info["name"]
            )
            thread.progress.connect(self._on_download_progress)
            thread.finished.connect(self._on_download_finished)
            thread.start()
            self._download_threads.append(thread)
            print(f"[DEBUG] Thread started for model: {model_info['name']}")
        else:
            print(f"[DEBUG] No model URL for {model_info['name']}, skipping")

        # mmproj varsa onu da indir
        if urls["mmproj"]:
            thread2 = DownloadThread(
                urls["mmproj"],
                model_folder,
                f"{folder_name}_mmproj"
            )
            thread2.progress.connect(self._on_download_progress)
            thread2.finished.connect(self._on_download_finished)
            thread2.start()
            self._download_threads.append(thread2)
            print(f"[DEBUG] Thread started for mmproj: {model_info['name']}")
        else:
            print(f"[DEBUG] No mmproj URL for {model_info['name']}, skipping")

    def _get_urls_from_json(self, ini_name, section_name):
        """model_urls.json'dan section'in URL'lerini al"""
        urls_json = ROOT / "model_urls.json"
        result = {"model": "", "mmproj": ""}

        print(f"[DEBUG] _get_urls_from_json: ini_name={ini_name}, section_name={section_name}")

        if not urls_json.exists():
            print(f"[DEBUG] model_urls.json not found at {urls_json}")
            return result

        try:
            with open(urls_json, "r", encoding="utf-8") as f:
                all_urls = json.load(f)

            print(f"[DEBUG] Loaded model_urls.json, keys: {list(all_urls.keys())}")

            # INI isminden 'gpu\d+' prefix'ini çıkar
            # gpu1vram4ram16models.ini -> vram4ram16models.ini
            import re
            json_key = re.sub(r'^gpu\d+', '', ini_name)
            
            print(f"[DEBUG] json_key after removing 'gpu': {json_key}")
            
            if json_key in all_urls:
                print(f"[DEBUG] Found json_key in all_urls, sections: {list(all_urls[json_key].keys())}")
                if section_name in all_urls[json_key]:
                    entry = all_urls[json_key][section_name]
                    if isinstance(entry, dict):
                        result["model"] = entry.get("model", "")
                        result["mmproj"] = entry.get("mmproj", "")
                    elif isinstance(entry, str):
                        result["model"] = entry
                    print(f"[DEBUG] Found entry for {section_name}: model={result['model'][:50]}...")
                else:
                    print(f"[DEBUG] section_name '{section_name}' NOT found in {json_key}")
            else:
                print(f"[DEBUG] json_key '{json_key}' NOT found in all_urls")
        except (json.JSONDecodeError, IOError) as e:
            print(f"[DEBUG] Error reading model_urls.json: {e}")

        return result

    def _download_all(self):
        """Sadece benzersiz modelleri ve vision mmproj'leri indir"""
        print(f"[DEBUG] _download_all called, _models count: {len(self._models)}")
        print(f"[DEBUG] _selected_ini: {self._selected_ini}")
        if not self._models:
            QMessageBox.information(self, "Info", "No models to download.")
            return

        # Benzersiz model dosyalarini topla (coder section'lari atla)
        downloaded_bases = set()  # Indirilen base model isimleri
        to_download = []  # Indirilecek modeller

        for model in self._models:
            name = model["name"]
            
            # coder section'lari atla (ayni model, sadece ayar farkli)
            if name.startswith("coder-") or name.startswith("codgemma-"):
                print(f"[DEBUG] Skipping coder section: {name}")
                continue
            
            # Model dosyasi adini cikar (section adinin ilk kismini al)
            # qwen3.6-vision -> qwen3.6
            # gemma-4-e4b-vision -> gemma-4-e4b
            base_name = name.replace("-vision", "").replace("-Vision", "")
            
            # Base model daha once indirildi mi? (sadece -vision olmayanlar)
            if "-vision" not in name and "-Vision" not in name:
                if base_name in downloaded_bases:
                    print(f"[DEBUG] Base model already downloaded: {base_name}, skipping {name}")
                    continue
                downloaded_bases.add(base_name)
            
            to_download.append(model)
            print(f"[DEBUG] Will download: {name} (base: {base_name})")

        if not to_download:
            QMessageBox.information(self, "Info", "All models already downloaded.")
            return

        # Onay sor
        reply = QMessageBox.question(
            self,
            "Download Confirmation",
            f"Download {len(to_download)} models?\n(Only unique model files, no coder sections)",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if reply != QMessageBox.StandardButton.Yes:
            return

        for model in to_download:
            print(f"[DEBUG] Downloading model: {model['name']}")
            self._download_model(model)

    def _on_download_progress(self, name, downloaded, total):
        if total > 0:
            percent = int((downloaded / total) * 100)
            downloaded_mb = downloaded / (1024 * 1024)
            total_mb = total / (1024 * 1024)
            self.download_status.setText(f"{name}: {downloaded_mb:.1f}/{total_mb:.1f} MB ({percent}%)")
            self.download_status.setStyleSheet("color: palette(text);")

    def _on_download_finished(self, name, result):
        if result.startswith("Error:"):
            self.download_status.setText(f"Error downloading {name}: {result}")
        else:
            self.download_status.setText(f"Completed: {name}")

        # Thread'i listeden cikar ve Qt cleanup yap
        for thread in self._download_threads[:]:
            if not thread.isRunning():
                self._download_threads.remove(thread)
                thread.deleteLater()
