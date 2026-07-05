"""
LLM Runner AIO - Ana Pencere
QMainWindow, QTabWidget, toolbar embed, tray minimize
"""

import sys
from pathlib import Path
from PyQt6.QtWidgets import (
    QMainWindow, QTabWidget, QWidget, QVBoxLayout, QSplitter, QSystemTrayIcon
)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QIcon

from app import AppManager
from ui.toolbar import Toolbar
from ui.tray import SystemTray
from tabs.system_detection import SystemDetectionTab
from tabs.servers import ServersTab
from tabs.picoding import PiCodingTab
from tabs.models import ModelsTab


class MainWindow(QMainWindow):
    """Ana uygulama penceresi"""

    def __init__(self):
        super().__init__()
        self._manager = AppManager()
        self._lang = self._manager.lang
        self._config = self._manager.config

        self._init_ui()
        self._connect_signals()
        self._update_ui_text()

    def _init_ui(self):
        # Logo
        icon_path = Path(__file__).parent.parent.parent / "assets" / "icon.ico"
        if icon_path.exists():
            self.setWindowIcon(QIcon(str(icon_path)))
        
        self.setWindowTitle(self._lang.get("app_title", "LLM Runner AIO"))
        self.setMinimumSize(900, 650)
        self.resize(1100, 750)

        # Central widget
        central = QWidget()
        self.setCentralWidget(central)
        main_layout = QVBoxLayout(central)
        main_layout.setContentsMargins(0, 0, 0, 0)
        main_layout.setSpacing(0)

        # Toolbar (üstte)
        self.toolbar = Toolbar()
        main_layout.addLayout(self.toolbar)

        # Tab widget (altta)
        self.tabs = QTabWidget()

        # Tab 1: System Detection
        self.tab_system = SystemDetectionTab()
        self.tabs.addTab(self.tab_system, self._lang.get("tab_system", "System Detection"))

        # Tab 2: Servers
        self.tab_servers = ServersTab()
        self.tabs.addTab(self.tab_servers, self._lang.get("tab_servers", "Servers"))

        # Tab 3: Pi Coding
        self.tab_picoding = PiCodingTab()
        self.tabs.addTab(self.tab_picoding, self._lang.get("tab_picoding", "Pi Coding"))

        # Tab 4: Models
        self.tab_models = ModelsTab()
        self.tabs.addTab(self.tab_models, self._lang.get("tab_models", "Models"))

        main_layout.addWidget(self.tabs)

        # Tray
        self.tray = SystemTray(self)

    def _connect_signals(self):
        # Tema değişimi
        self.toolbar.theme_changed.connect(self._manager.apply_theme)

        # Font değişimi
        self.toolbar.font_size_changed.connect(self._manager.apply_font_size)

        # Dil değişimi
        self._manager.lang.lang_changed.connect(self._update_ui_text)

        # Otomatik sunucu baslatma (Windows baslangicinda)
        from PyQt6.QtCore import QTimer
        QTimer.singleShot(2000, self._auto_start_servers)

    def _auto_start_servers(self):
        """Kaydedilen sunucuları otomatik başlat"""
        if not self._config.get("auto_start_servers", False):
            print("[AUTO-START] Disabled")
            return
        if not self._config.get("start_with_windows", False):
            print("[AUTO-START] Windows start disabled")
            return

        # Kaydedilen sunucu listesini al
        started_servers = self._config.get("started_servers", [])
        if not started_servers:
            print("[AUTO-START] No saved servers")
            return

        print(f"[AUTO-START] Starting servers: {started_servers}")

        # Her kaydedilen sunucuyu başlat
        for server in started_servers:
            try:
                if server == "searxng":
                    self.tab_servers._start_searxng()
                    print(f"[AUTO-START]   Started: {server}")
                elif server == "openwebui":
                    self.tab_servers._start_openwebui()
                    print(f"[AUTO-START]   Started: {server}")
                elif server == "llamacpp":
                    self.tab_servers._start_llamacpp()
                    print(f"[AUTO-START]   Started: {server}")
                elif server == "vane":
                    self.tab_servers._start_vane()
                    print(f"[AUTO-START]   Started: {server}")
            except Exception as e:
                print(f"[AUTO-START] Failed to start {server}: {e}")

    def closeEvent(self, event):
        """Pencere kapatıldığında tüm sunucuları durdur ve kapat"""
        # Önce tüm sunucuları durdur
        if hasattr(self, 'tab_servers'):
            self.tab_servers.stop_all_servers()

        # Tray'i gizle
        if hasattr(self.tray, '_tray_icon'):
            self.tray._tray_icon.hide()

        event.accept()

    def _update_ui_text(self):
        """Dil degisikliginde UI metinlerini güncelle"""
        lang = self._manager.lang
        self.setWindowTitle(lang.get("app_title", "LLM Runner AIO"))

        # Tab isimlerini güncelle
        tab_names = [
            lang.get("tab_system", "System Detection"),
            lang.get("tab_servers", "Servers"),
            lang.get("tab_picoding", "Pi Coding"),
            lang.get("tab_models", "Models"),
        ]
        for i, name in enumerate(tab_names):
            self.tabs.setTabText(i, name)

        # Toolbar settings butonunu güncelle
        self.toolbar.settings_btn.setText("⚙ " + lang.get("label_settings", "Settings"))

    def changeEvent(self, event):
        """Minimize edildiğinde tray'e gizle / Pencere geri yüklendiğinde health check"""
        from PyQt6.QtCore import QEvent
        from PyQt6.QtWidgets import QSystemTrayIcon
        
        if event.type() == QEvent.Type.WindowStateChange:
            if self.isMinimized():
                self.hide()
                if hasattr(self.tray, 'tray') and self.tray.tray:
                    self.tray.tray.showMessage(
                        "LLM Runner AIO",
                        "Pencere sistem tepsisine gizlendi. A\u00e7mak i\u00e7in \u00e7ift t\u0131klay\u0131n.",
                        QSystemTrayIcon.MessageIcon.Information,
                        2000
                    )
            else:
                # Pencere geri yüklendi (maximize, restore, vb.) — uyku modu sonrası donmuş servisleri kontrol et
                if hasattr(self, 'tab_servers') and hasattr(self.tab_servers, '_check_servers_health'):
                    try:
                        self.tab_servers._check_servers_health()
                    except Exception as e:
                        print(f"[HEALTH] Window restored health check failed: {e}")
        super().changeEvent(event)
