"""
LLM Runner AIO - Ayarlar Diyaloğu
Tema, font boyutu, dil, Windows ile başla, otomatik sunucu başlatma
"""

from PyQt6.QtWidgets import (
    QDialog, QVBoxLayout, QHBoxLayout, QGroupBox, QPushButton,
    QLabel, QRadioButton, QComboBox, QCheckBox, QMessageBox
)
from PyQt6.QtCore import Qt, pyqtSignal

from app import AppManager


class SettingsDialog(QDialog):
    """Uygulama ayarları diyaloğu"""

    def __init__(self, parent=None):
        super().__init__(parent)
        self._manager = AppManager()
        self._config = self._manager.config
        self._lang = self._manager.lang
        self._font_size = self._config.get("font_size", 13)

        self._build_ui()
        self._update_language()
        self._manager.lang.lang_changed.connect(self._update_language)

    def closeEvent(self, event):
        """Dialog kapanirken parent'i kapatma"""
        event.accept()

    def _update_language(self):
        """Dil değiştiğinde UI metinlerini güncelle"""
        self.setWindowTitle(self._lang.get("label_settings", "Settings"))
        self.theme_dark_radio.setText(self._lang.get("theme_dark", "Dark Theme"))
        self.theme_light_radio.setText(self._lang.get("theme_light", "Light Theme"))
        self.startup_check.setText(self._lang.get("cb_start_windows", "Start with Windows"))
        self.auto_servers_check.setText(self._lang.get("cb_auto_servers", "Auto-start servers"))

        # GroupBox başlıklarını güncelle
        self.findChild(QGroupBox, "theme_group").setTitle(self._lang.get("label_theme", "Theme"))
        self.findChild(QGroupBox, "font_group").setTitle(self._lang.get("label_font_size", "Font Size"))
        self.findChild(QGroupBox, "lang_group").setTitle(self._lang.get("label_language", "Language"))
        self.findChild(QGroupBox, "startup_group").setTitle(self._lang.get("label_start_auto", "Startup Settings"))

        # Kayıtlı sunucular etiketi
        servers_label = self.findChild(QLabel, "servers_label")
        if servers_label:
            servers_label.setText(self._lang.get("label_saved_servers", "Saved servers:"))

        # Kapat butonu
        close_btn = self.findChild(QPushButton, "close_btn")
        if close_btn:
            close_btn.setText(self._lang.get("btn_close_settings", "Close"))

        # Sunucu checkbox'larını güncelle
        server_names = {
            "searxng": "SearXNG",
            "openwebui": "Open WebUI",
            "llamacpp": "llama.cpp",
            "vane": "Vane",
        }
        for key, cb in self._server_checks.items():
            cb.setText(server_names.get(key, key))

    def _build_ui(self):
        self.setMinimumSize(520, 650)
        layout = QVBoxLayout()
        layout.setContentsMargins(20, 20, 20, 20)
        layout.setSpacing(14)

        # === TEMA ===
        theme_group = QGroupBox(self._lang.get("label_theme", "Theme"))
        theme_layout = QVBoxLayout()

        self.theme_dark_radio = QRadioButton(self._lang.get("theme_dark", "Dark Theme"))
        self.theme_light_radio = QRadioButton(self._lang.get("theme_light", "Light Theme"))
        self.theme_dark_radio.setAutoExclusive(True)
        self.theme_light_radio.setAutoExclusive(True)
        current_theme = self._config.get("theme", "dark")
        self.theme_dark_radio.setChecked(current_theme == "dark")
        self.theme_light_radio.setChecked(current_theme == "light")
        self.theme_dark_radio.toggled.connect(self._on_theme_toggled)
        self.theme_light_radio.toggled.connect(self._on_theme_toggled)

        theme_layout.addWidget(self.theme_dark_radio)
        theme_layout.addWidget(self.theme_light_radio)
        theme_group.setLayout(theme_layout)
        theme_group.setObjectName("theme_group")

        layout.addWidget(theme_group)

        # === FONT BOYUTU ===
        font_group = QGroupBox(self._lang.get("label_font_size", "Font Size"))
        font_group.setObjectName("font_group")
        font_layout = QHBoxLayout()

        font_minus = QPushButton("A-")
        font_minus.setFixedSize(32, 32)
        font_minus.clicked.connect(self._decrease_font)
        self.font_label = QLabel(f"{self._font_size}px")
        self.font_label.setFixedWidth(50)
        self.font_label.setAlignment(Qt.AlignmentFlag.AlignCenter)
        font_plus = QPushButton("A+")
        font_plus.setFixedSize(32, 32)
        font_plus.clicked.connect(self._increase_font)

        font_layout.addWidget(font_minus)
        font_layout.addWidget(self.font_label)
        font_layout.addWidget(font_plus)
        font_group.setLayout(font_layout)
        font_group.setObjectName("font_group")

        layout.addWidget(font_group)

        # === DİL ===
        lang_group = QGroupBox(self._lang.get("label_language", "Language"))
        lang_group.setObjectName("lang_group")
        lang_layout = QVBoxLayout()

        self._languages = {
            "en": "English",
            "tr": "Türkçe",
            "es": "Español",
            "de": "Deutsch",
            "fr": "Français",
            "pt": "Português",
            "zh": "中文",
            "ja": "日本語",
        }
        self.lang_combo = QComboBox()
        current_lang = self._config.get("language", "en")
        for code, name in self._languages.items():
            self.lang_combo.addItem(name, code)
            if code == current_lang:
                self.lang_combo.setCurrentIndex(self.lang_combo.count() - 1)
        self.lang_combo.currentIndexChanged.connect(self._on_language_changed)

        lang_layout.addWidget(self.lang_combo)
        lang_group.setLayout(lang_layout)
        lang_group.setObjectName("lang_group")

        layout.addWidget(lang_group)

        # === BAŞLANGIÇ AYARLARI ===
        startup_group = QGroupBox(self._lang.get("label_start_auto", "Startup Settings"))
        startup_group.setObjectName("startup_group")
        startup_layout = QVBoxLayout()

        self.startup_check = QCheckBox(self._lang.get("cb_start_windows", "Start with Windows"))
        self.startup_check.setChecked(self._config.get("start_with_windows", False))
        self.startup_check.clicked.connect(self._on_startup_toggled)

        self.auto_servers_check = QCheckBox(self._lang.get("cb_auto_servers", "Auto-start servers"))
        self.auto_servers_check.setChecked(self._config.get("auto_start_servers", False))
        self.auto_servers_check.clicked.connect(self._on_auto_servers_toggled)

        startup_layout.addWidget(self.startup_check)
        startup_layout.addWidget(self.auto_servers_check)
        
        # Kayıtlı sunucular
        servers_label = QLabel(self._lang.get("label_saved_servers", "Saved servers:"))
        servers_label.setObjectName("servers_label")
        servers_label.setStyleSheet("font-weight: bold; padding: 4px 0 2px 0;")
        startup_layout.addWidget(servers_label)
        
        self.server_checks_layout = QVBoxLayout()
        self.server_checks_layout.setSpacing(2)
        self.server_checks_layout.setContentsMargins(12, 2, 2, 2)
        self._server_checks = {}  # server_key -> QCheckBox
        
        self._update_server_checks()
        self._update_server_checks_enabled()
        
        startup_layout.addLayout(self.server_checks_layout)
        startup_group.setLayout(startup_layout)
        startup_group.setObjectName("startup_group")

        layout.addWidget(startup_group)
        layout.addStretch(1)

        # === KAPAT ===
        close_btn = QPushButton(self._lang.get("btn_close_settings", "Close"))
        close_btn.setFixedWidth(100)
        close_btn.setObjectName("close_btn")
        close_btn.clicked.connect(self.accept)
        layout.addWidget(close_btn, 0, Qt.AlignmentFlag.AlignCenter)

        self.setLayout(layout)

    def _on_theme_toggled(self, checked):
        """Tema degisikligi"""
        if not checked:
            return
        if self.theme_dark_radio.isChecked():
            theme = "dark"
        elif self.theme_light_radio.isChecked():
            theme = "light"
        else:
            return
        self._config.set("theme", theme)
        self._manager.apply_theme(theme)

    def _increase_font(self):
        new_size = min(self._font_size + 1, 22)
        if new_size > self._font_size:
            self._font_size = new_size
            self.font_label.setText(f"{self._font_size}px")
            self._manager.apply_font_size(self._font_size)

    def _decrease_font(self):
        new_size = max(self._font_size - 1, 9)
        if new_size < self._font_size:
            self._font_size = new_size
            self.font_label.setText(f"{self._font_size}px")
            self._manager.apply_font_size(self._font_size)

    def _on_language_changed(self, index):
        """Dil degisikligi"""
        code = self.lang_combo.itemData(index)
        if code:
            self._manager.change_language(code)

    def _on_startup_toggled(self, checked):
        """Windows ile basla"""
        self._config.set("start_with_windows", checked)
        self._set_windows_startup(checked)

    def _on_auto_servers_toggled(self, checked):
        """Otomatik sunucu baslatma"""
        self._config.set("auto_start_servers", checked)
        self._update_server_checks_enabled()

    def _update_server_checks_enabled(self):
        """Auto-start durumuna gore server checkbox'larini aktif/pasif yap"""
        auto_enabled = self._config.get("auto_start_servers", False)
        for cb in self._server_checks.values():
            cb.setEnabled(auto_enabled)

    def _update_server_checks(self):
        """Kayıtlı sunucu checkbox'larını güncelle"""
        # Eski checkbox'ları temizle
        for key, cb in self._server_checks.items():
            self.server_checks_layout.removeWidget(cb)
            cb.deleteLater()
        self._server_checks.clear()
        
        # Tüm sunucu isimleri
        server_names = {
            "searxng": "SearXNG",
            "openwebui": "Open WebUI",
            "llamacpp": "llama.cpp",
            "vane": "Vane",
        }
        
        # Kaydedilen sunucu listesini al
        started = self._config.get("started_servers", [])
        
        for key, name in server_names.items():
            cb = QCheckBox(name)
            cb.setChecked(key in started)
            cb.setStyleSheet("padding: 4px 0 4px 16px;")
            cb.clicked.connect(lambda checked, k=key: self._on_server_toggle(k, checked))
            self.server_checks_layout.addWidget(cb)
            self._server_checks[key] = cb
        
        # Auto-start durumuna gore enable/disable et
        self._update_server_checks_enabled()

    def _on_server_toggle(self, key, checked):
        """Sunucu checkbox'ı değiştirildiğinde kayıtlı listeyi güncelle"""
        started = self._config.get("started_servers", [])
        if checked and key not in started:
            started.append(key)
        elif not checked and key in started:
            started.remove(key)
        self._config.set("started_servers", started)
        print(f"[SETTINGS] Server {key} checked={checked}, started_servers={self._config.get('started_servers')}")

    @staticmethod
    def _set_windows_startup(self, enabled):
        """Bug #11: Windows başlangıcına ekle/çıkar - try-except + bildirim"""
        import winreg
        import sys
        import os
        
        # .exe içinde çalışıyorsa sys.executable kullan, yoksa main.py
        if getattr(sys, 'frozen', False):
            # PyInstaller .exe içinde
            exe_path = sys.executable
            value_str = f'"{exe_path}"'
        else:
            # Normal Python içinde
            from app import ROOT
            main_py = ROOT / "launcher" / "main.py"
            import shutil
            pythonw_path = shutil.which("pythonw.exe")
            if pythonw_path:
                value_str = f'{pythonw_path} "{main_py}"'
            else:
                value_str = f'pythonw.exe "{main_py}"'
        
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                key_path,
                0,
                winreg.KEY_SET_VALUE
            )

            if enabled:
                winreg.SetValueEx(key, "LLMRunnerAIO", 0, winreg.REG_SZ, value_str)
                QMessageBox.information(
                    self,
                    self._lang.get("info_startup_enabled", "Startup Enabled"),
                    self._lang.get("msg_startup_added", "LLM Runner AIO will now start automatically with Windows.")
                )
            else:
                try:
                    winreg.DeleteValue(key, "LLMRunnerAIO")
                    QMessageBox.information(
                        self,
                        self._lang.get("info_startup_disabled", "Startup Disabled"),
                        self._lang.get("msg_startup_removed", "LLM Runner AIO will no longer start automatically with Windows.")
                    )
                except FileNotFoundError:
                    # Önceden eklenmemişse sorun değil
                    pass

            winreg.CloseKey(key)

        except PermissionError:
            QMessageBox.warning(
                self,
                self._lang.get("warning_permission_denied", "Permission Denied"),
                self._lang.get("error_permission_msg", "Cannot modify Windows startup settings. Try running as administrator.")
            )
        except Exception as e:
            QMessageBox.critical(
                self,
                self._lang.get("critical_error", "Critical Error"),
                self._lang.get("error_registry_failed", f"Failed to update startup settings: {str(e)}")
            )
