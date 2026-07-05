"""
LLM Runner AIO - Application Core
QApplication yönetimi, tema, font, config singleton
"""

import json
import sys
import logging
import logging.handlers
from pathlib import Path
from PyQt6.QtWidgets import QApplication
from PyQt6.QtCore import pyqtSignal, QObject

# ROOT dizini = launcher/'in bir üstü
ROOT = Path(__file__).parent.parent
CONFIG_PATH = ROOT / "launcher" / "config.json"
LANG_DIR = ROOT / "launcher" / "lang"
LANG_PATH = LANG_DIR / "en.json"

# Desteklenen diller
SUPPORTED_LANGUAGES = ["en", "tr", "es", "de", "fr", "pt", "zh", "ja"]


class LanguageManager(QObject):
    """Tüm UI stringlerini tek dosyadan yönetir"""
    lang_changed = pyqtSignal()

    def __init__(self):
        super().__init__()
        self._lang = {}
        self._current_lang = "en"
        # Config'den kaydedilen dili yükle (eğer varsa)
        try:
            if CONFIG_PATH.exists():
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    saved_config = json.load(f)
                saved_lang = saved_config.get("language", "en")
                if saved_lang in SUPPORTED_LANGUAGES:
                    self._load(saved_lang)
                else:
                    self._load("en")
            else:
                self._load("en")
        except Exception:
            self._load("en")

    def _load(self, lang_code):
        lang_file = LANG_DIR / f"{lang_code}.json"
        try:
            with open(lang_file, "r", encoding="utf-8") as f:
                self._lang = json.load(f)
            self._current_lang = lang_code
        except FileNotFoundError:
            # Fallback: ingilizce yükle
            try:
                with open(LANG_PATH, "r", encoding="utf-8") as f:
                    self._lang = json.load(f)
            except FileNotFoundError:
                self._lang = {}
            self._current_lang = "en"

    def get(self, key, default=""):
        return self._lang.get(key, default)

    def __getitem__(self, key):
        return self._lang.get(key, "")

    def get_current(self):
        return self._current_lang


class ConfigManager:
    """config.json yönetimi - singleton"""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._data = {}
        self._defaults = {
            "theme": "dark",
            "font_size": 13,
            "picoding_path": "",
            "searxng_port": 8080,
            "openwebui_port": 3000,
            "llamacpp_port": 1234,
            "llamacpp_ctx": 8192,
            "start_with_windows": False,
            "selected_ini": "",
            "vram_gb": 0.0,
            "ram_gb": 0.0,
            "llamacpp_selected_model": "",
            "auto_start_servers": False,
            "started_servers": [],
            "language": "en",
        }
        self._load()

    def _load(self):
        if CONFIG_PATH.exists():
            try:
                with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                    self._data = json.load(f)
            except (json.JSONDecodeError, IOError):
                self._data = {}
        # Eksik anahtarları default ile doldur
        for k, v in self._defaults.items():
            if k not in self._data:
                self._data[k] = v

    def get(self, key, default=None):
        if default is not None:
            return self._data.get(key, default)
        return self._data.get(key, self._defaults.get(key))

    def set(self, key, value):
        self._data[key] = value
        self._save()

    def _save(self):
        """Bug #6: Ayar kalıcılığı - atomic write ile güvenli kaydetme"""
        try:
            import os as _os
            CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
            # Atomic write: önce temp dosyaya yaz, sonra taşı
            temp_path = CONFIG_PATH.with_suffix(".json.tmp")
            with open(temp_path, "w", encoding="utf-8") as f:
                json.dump(self._data, f, indent=2, ensure_ascii=False)
                f.flush()
                _os.fsync(f.fileno())  # Fiziksel diske yazmayı garanti et
            # Windows'ta hedef dosya varsa os.replace overwrite eder
            _os.replace(temp_path, CONFIG_PATH)
        except IOError as e:
            print(f"Config save error: {e}")


# ============================================
# Bug #14: RotatingFileHandler Log Rotasyonu
# ============================================
def setup_logging():
    """RotatingFileHandler ile log rotasyonu kurar"""
    log_file = ROOT / "logs" / "app.log"
    log_file.parent.mkdir(parents=True, exist_ok=True)

    logger = logging.getLogger()
    logger.setLevel(logging.DEBUG)

    # RotatingFileHandler - 5MB dosya başına max 3 yedek
    file_handler = logging.handlers.RotatingFileHandler(
        log_file,
        maxBytes=5 * 1024 * 1024,  # 5 MB
        backupCount=3,
        encoding="utf-8"
    )
    file_handler.setLevel(logging.DEBUG)
    file_formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    file_handler.setFormatter(file_formatter)
    logger.addHandler(file_handler)

    # Console handler
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setLevel(logging.INFO)
    console_formatter = logging.Formatter("%(asctime)s - %(levelname)s - %(message)s")
    console_handler.setFormatter(console_formatter)
    logger.addHandler(console_handler)

    def __getitem__(self, key):
        return self._data.get(key, self._defaults.get(key))


class AppManager:
    """Singleton - QApplication, tema ve font yönetimi"""
    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self.config = ConfigManager()
        self.lang = LanguageManager()
        self._app = None

    def get_app(self):
        if self._app is None:
            self._app = QApplication.instance()
            if self._app is None:
                self._app = QApplication(sys.argv)
                self._app.setStyle("Fusion")
        return self._app

    def apply_theme(self, theme):
        """Dark veya Light tema uygula"""
        self.config.set("theme", theme)
        app = self.get_app()

        if theme == "dark":
            styles = {
                "background": "#1e1e2e",
                "surface": "#2a2a3e",
                "accent": "#7c3aed",
                "accent_hover": "#6d28d9",
                "text": "#e2e8f0",
                "text_muted": "#94a3b8",
                "border": "#374151",
                "success": "#10b981",
                "danger": "#ef4444",
                "warning": "#f59e0b",
                "log_bg": "#0f172a",
                "log_text": "#4ade80",
            }
        else:
            styles = {
                "background": "#f8fafc",
                "surface": "#ffffff",
                "accent": "#6d28d9",
                "accent_hover": "#5b21b6",
                "text": "#1e293b",
                "text_muted": "#64748b",
                "border": "#e2e8f0",
                "success": "#059669",
                "danger": "#dc2626",
                "warning": "#d97706",
                "log_bg": "#f1f5f9",
                "log_text": "#166534",
            }

        fs = self.config.get("font_size", 13)

        app.setStyleSheet(f"""
            QMainWindow {{
                background-color: {styles['background']};
                color: {styles['text']};
            }}
            QWidget {{
                background-color: {styles['background']};
                color: {styles['text']};
                font-size: {fs}px;
            }}
            QFrame {{
                background-color: {styles['surface']};
                border: 1px solid {styles['border']};
                border-radius: 6px;
            }}
            QPushButton {{
                background-color: {styles['accent']};
                color: {styles['text']};
                border: none;
                border-radius: 6px;
                padding: 8px 16px;
                font-size: {fs}px;
                font-weight: bold;
            }}
            QPushButton:hover {{
                background-color: {styles['accent_hover']};
            }}
            QPushButton:disabled {{
                background-color: {styles['border']};
                color: {styles['text_muted']};
            }}
            QLabel {{
                color: {styles['text']};
                font-size: {fs}px;
            }}
            QLabel[muted="true"] {{
                color: {styles['text_muted']};
            }}
            QTextEdit {{
                background-color: {styles['log_bg']};
                color: {styles['log_text']};
                border: 1px solid {styles['border']};
                border-radius: 6px;
                padding: 6px;
                font-family: 'Consolas', 'Courier New', monospace;
                font-size: {fs - 1}px;
            }}
            QTabWidget::pane {{
                border: 1px solid {styles['border']};
                border-radius: 6px;
                background-color: {styles['background']};
            }}
            QTabBar::tab {{
                background-color: {styles['surface']};
                color: {styles['text']};
                padding: 10px 20px;
                border: 1px solid {styles['border']};
                border-bottom: none;
                border-top-left-radius: 6px;
                border-top-right-radius: 6px;
                font-size: {fs}px;
            }}
            QTabBar::tab:selected {{
                background-color: {styles['accent']};
                color: {styles['text']};
                font-weight: bold;
            }}
            QTabBar::tab:hover {{
                background-color: {styles['accent_hover']};
            }}
            QLineEdit {{
                background-color: {styles['surface']};
                color: {styles['text']};
                border: 1px solid {styles['border']};
                border-radius: 6px;
                padding: 6px 10px;
                font-size: {fs}px;
            }}
            QLineEdit:focus {{
                border: 1px solid {styles['accent']};
            }}
            QSpinBox, QComboBox {{
                background-color: {styles['surface']};
                color: {styles['text']};
                border: 1px solid {styles['border']};
                border-radius: 6px;
                padding: 6px 10px;
                font-size: {fs}px;
            }}
            QCheckBox {{
                color: {styles['text']};
                font-size: {fs}px;
                spacing: 8px;
            }}
            QCheckBox::indicator {{
                width: 18px;
                height: 18px;
                border: 2px solid {styles['border']};
                border-radius: 4px;
                background-color: {styles['surface']};
            }}
            QCheckBox::indicator:checked {{
                background-color: {styles['accent']};
                border-color: {styles['accent']};
            }}
            QProgressBar {{
                border: 1px solid {styles['border']};
                border-radius: 4px;
                text-align: center;
                font-size: {fs - 1}px;
            }}
            QProgressBar::chunk {{
                background-color: {styles['accent']};
                border-radius: 3px;
            }}
            QListWidget {{
                background-color: {styles['surface']};
                color: {styles['text']};
                border: 1px solid {styles['border']};
                border-radius: 6px;
                padding: 4px;
                font-size: {fs}px;
            }}
            QListWidget::item:selected {{
                background-color: {styles['accent']};
                color: {styles['text']};
            }}
            QGroupBox {{
                background-color: {styles['surface']};
                border: 1px solid {styles['border']};
                border-radius: 8px;
                margin-top: 12px;
                padding-top: 16px;
                font-size: {fs}px;
                font-weight: bold;
                color: {styles['text']};
            }}
            QGroupBox::title {{
                subcontrol-origin: margin;
                left: 12px;
                padding: 0 6px;
                color: {styles['accent']};
            }}
            QScrollArea {{
                border: none;
                background-color: {styles['background']};
            }}
            QScrollBar:vertical {{
                background-color: {styles['background']};
                width: 10px;
                border-radius: 5px;
            }}
            QScrollBar::handle:vertical {{
                background-color: {styles['border']};
                border-radius: 4px;
                min-height: 30px;
            }}
            QScrollBar::handle:vertical:hover {{
                background-color: {styles['accent']};
            }}
            QScrollBar::add-line:vertical, QScrollBar::sub-line:vertical {{
                height: 0px;
            }}
            #Toolbar QPushButton {{
                background-color: {styles['surface']};
                color: {styles['text']};
                border: 1px solid {styles['border']};
                border-radius: 6px;
                padding: 6px 12px;
                font-size: {fs}px;
                font-weight: bold;
            }}
            #Toolbar QPushButton:hover {{
                background-color: {styles['accent']};
                border: 1px solid {styles['accent']};
            }}
            #Toolbar QPushButton:pressed {{
                background-color: {styles['accent_hover']};
            }}
            QSplitter {{
                background-color: {styles['background']};
            }}
            QSplitter::handle {{
                background-color: {styles['border']};
            }}
        """)

    def apply_font_size(self, size):
        """Font boyutunu uygula (tema bilgisi içinde)"""
        self.config.set("font_size", size)
        self.apply_theme(self.config.get("theme", "dark"))

    def get_language(self, code=None):
        """Mevcut dili döndür"""
        if code:
            self.lang._load(code)
        return self.lang.get_current()

    def change_language(self, code):
        """Dili değiştir ve UI'ı güncelle"""
        if code in SUPPORTED_LANGUAGES:
            self.config.set("language", code)
            self.lang._load(code)
            self.lang.lang_changed.emit()
            return True
        return False

    def initialize(self):
        """Uygulamayı başlat: config yükle, tema uygula"""
        app = self.get_app()
        app.setStyle("Fusion")
        theme = self.config.get("theme", "dark")
        self.apply_theme(theme)


def run():
    """Uygulamayı başlat"""
    manager = AppManager()
    manager.initialize()
    return manager
