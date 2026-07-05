"""
LLM Runner AIO - Sistem Tray Yönetimi
Minimize to tray, tray menu, double-click show
"""

import sys
from PyQt6.QtWidgets import QSystemTrayIcon, QMenu
from PyQt6.QtGui import QAction
from PyQt6.QtGui import QIcon
from PyQt6.QtCore import Qt

from app import ROOT


class SystemTray:
    """Sistem tray ikonu ve menüsü"""

    def __init__(self, main_window):
        self.window = main_window
        self.tray = None
        self._create_tray()

    def _create_tray(self):
        from app import AppManager
        lang = AppManager().lang

        # Tray ikonu oluştur
        self.tray = QSystemTrayIcon()

        # İkon yoksa sistem ikonu kullan
        icon_path = ROOT / "assets" / "icon.ico"
        if icon_path.exists():
            self.tray.setIcon(QIcon(str(icon_path)))
        else:
            icon_path_png = ROOT / "assets" / "icon.png"
            if icon_path_png.exists():
                self.tray.setIcon(QIcon(str(icon_path_png)))
            else:
                self.tray.setIcon(QIcon.fromTheme("applications-system"))

        # Tooltip
        self.tray.setToolTip(lang.get("app_title", "LLM Runner AIO"))

        # Menü
        menu = QMenu()

        show_action = QAction(lang.get("tray_show", "Show Window"), menu)
        show_action.triggered.connect(self._show_window)
        menu.addAction(show_action)

        hide_action = QAction(lang.get("tray_hide", "Hide Window"), menu)
        hide_action.triggered.connect(self._hide_window)
        menu.addAction(hide_action)

        menu.addSeparator()

        quit_action = QAction(lang.get("tray_quit", "Quit"), menu)
        quit_action.triggered.connect(self._quit_app)
        menu.addAction(quit_action)

        self.tray.setContextMenu(menu)

        # Çift tıklama = göster
        self.tray.activated.connect(self._on_activated)

        self.tray.show()

    def _show_window(self):
        self.window.showNormal()
        self.window.raise_()
        self.window.activateWindow()

    def _hide_window(self):
        self.window.hide()

    def _quit_app(self):
        from PyQt6.QtWidgets import QApplication
        QApplication.quit()

    def _on_activated(self, reason):
        if reason == QSystemTrayIcon.ActivationReason.DoubleClick:
            self._show_window()

    def hide_on_close(self, event):
        """Pencere kapatıldığında tray'e gizle"""
        event.ignore()
        self._hide_window()
