"""
LLM Runner AIO - Toolbar
Tema toggle, font +/-, Windows startup checkbox
"""

import winreg
import sys
import os
from pathlib import Path
from PyQt6.QtWidgets import QHBoxLayout, QPushButton, QLabel
from PyQt6.QtCore import pyqtSignal, Qt, QUrl
from PyQt6.QtGui import QFont, QDesktopServices

from app import ROOT, AppManager


class Toolbar(QHBoxLayout):
    """Üst toolbar: başlık, tema toggle, font +/-, ayarlar butonu"""

    theme_changed = pyqtSignal(str)
    font_size_changed = pyqtSignal(int)
    settings_requested = pyqtSignal()

    def __init__(self):
        super().__init__()
        self._manager = AppManager()
        self._lang = self._manager.lang
        self._config = self._manager.config
        self._font_size = self._config.get("font_size", 13)

        self._build()
        self._manager.lang.lang_changed.connect(self._update_language)

    def _build(self):
        # Sol: başlık
        title_label = QLabel(self._lang.get("app_title", "LLM Runner AIO"))
        title_label.setFont(QFont("Segoe UI", 16, QFont.Weight.Bold))
        title_label.setStyleSheet("color: palette(text);")
        self.addWidget(title_label)

        self.addStretch()

        # Destek butonu
        self.support_btn = QPushButton("☕ " + self._lang.get("btn_support", "Support Me"))
        self.support_btn.setFixedSize(145, 32)
        self.support_btn.clicked.connect(self._open_support)
        self.addWidget(self.support_btn)

        self.addSpacing(10)

        # Ayarlar butonu
        self.settings_btn = QPushButton("⚙ " + self._lang.get("label_settings", "Settings"))
        self.settings_btn.setFixedSize(120, 32)
        self.settings_btn.clicked.connect(self._open_settings)
        self.addWidget(self.settings_btn)



    def _update_language(self):
        """Dil değiştiğinde buton metinlerini güncelle"""
        self.support_btn.setText("☕ " + self._lang.get("btn_support", "Support Me"))
        self.settings_btn.setText("⚙ " + self._lang.get("label_settings", "Settings"))

    def _open_support(self):
        """Ko-fi destek sayfasini ac"""
        QDesktopServices.openUrl(QUrl("https://ko-fi.com/vincespeed"))

    def _toggle_theme(self):
        current = self._config.get("theme", "dark")
        new_theme = "light" if current == "dark" else "dark"
        self._config.set("theme", new_theme)
        self.theme_btn.setText("☀" if new_theme == "dark" else "🌙")
        self.theme_changed.emit(new_theme)

    def _increase_font(self):
        new_size = min(self._font_size + 1, 22)
        if new_size > self._font_size:
            self._font_size = new_size
            self.font_label.setText(f"{self._font_size}px")
            self.font_size_changed.emit(self._font_size)

    def _decrease_font(self):
        new_size = max(self._font_size - 1, 9)
        if new_size < self._font_size:
            self._font_size = new_size
            self.font_label.setText(f"{self._font_size}px")
            self.font_size_changed.emit(self._font_size)

    def _toggle_startup(self, checked):
        self._config.set("start_with_windows", checked)
        self._set_windows_startup(checked)

    def _open_settings(self):
        """Ayarlar diyalogunu ac"""
        from ui.settings_dialog import SettingsDialog
        from PyQt6.QtWidgets import QApplication
        # Toolbar bir layout, QWidget degil. Parent olarak active window kullan.
        parent = QApplication.activeWindow()
        dialog = SettingsDialog(parent)
        dialog.exec()

    @staticmethod
    def _set_windows_startup(enabled):
        """Windows başlangıcına ekle/çıkar"""
        main_py = ROOT / "launcher" / "main.py"
        key_path = r"Software\Microsoft\Windows\CurrentVersion\Run"

        try:
            key = winreg.OpenKey(
                winreg.HKEY_CURRENT_USER,
                key_path,
                0,
                winreg.KEY_SET_VALUE
            )

            if enabled:
                pythonw = "pythonw.exe"
                # pythonw.exe path'ini bul (PATH üzerinde)
                try:
                    path_key = winreg.OpenKey(
                        winreg.HKEY_CURRENT_USER,
                        r"Environment",
                        0,
                        winreg.KEY_READ
                    )
                    env_path, _ = winreg.QueryValueEx(path_key, "PATH")
                    winreg.CloseKey(path_key)
                    import shutil
                    pythonw_path = shutil.which("pythonw.exe")
                    if pythonw_path:
                        pythonw = pythonw_path
                except Exception:
                    pass

                value = f'{pythonw} "{main_py}"'
                winreg.SetValueEx(key, "LLMRunnerAIO", 0, winreg.REG_SZ, value)
            else:
                try:
                    winreg.DeleteValue(key, "LLMRunnerAIO")
                except FileNotFoundError:
                    pass  # Zaten yok

            winreg.CloseKey(key)
        except PermissionError:
            pass  # Registry yazma izni yok
