"""
LLM Runner AIO - Tab 4: Models
GGUF model yönetimi — tarama, silme, yenileme
"""

import os
from pathlib import Path

from PyQt6.QtWidgets import (
    QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QListWidget, QListWidgetItem, QGroupBox, QWidget,
    QScrollArea, QMessageBox
)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont

from app import ROOT, AppManager


class ModelsTab(QWidget):
    """Tab 4: Model Yönetimi"""

    def __init__(self):
        super().__init__()
        self._manager = AppManager()
        self._lang = self._manager.lang
        self._models_dir = ROOT / "models"

        self._init_ui()
        self._scan_models()
        self._manager.lang.lang_changed.connect(self._update_lang)

    def _init_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(10)

        scroll = QScrollArea()
        scroll.setWidgetResizable(True)
        scroll_content = QWidget()
        scroll_layout = QVBoxLayout(scroll_content)
        scroll_layout.setSpacing(10)

        # Butonlar
        btn_layout = QHBoxLayout()

        self.refresh_btn = QPushButton(self._lang.get("btn_refresh", "Refresh"))
        self.refresh_btn.setObjectName("refresh_btn")
        self.refresh_btn.clicked.connect(self._scan_models)
        btn_layout.addWidget(self.refresh_btn)

        self.delete_btn = QPushButton(self._lang.get("btn_delete", "Delete Selected"))
        self.delete_btn.setObjectName("delete_btn")
        self.delete_btn.clicked.connect(self._delete_selected)
        btn_layout.addWidget(self.delete_btn)
        btn_layout.addStretch()

        scroll_layout.addLayout(btn_layout)

        # Model listesi
        self.model_list = QListWidget()
        self.model_list.setSelectionMode(QListWidget.SelectionMode.MultiSelection)
        scroll_layout.addWidget(self.model_list, 1)

        # Toplam depolama
        self.storage_label = QLabel("")
        self.storage_label.setStyleSheet("font-size: 13px; font-weight: bold; padding: 4px;")
        scroll_layout.addWidget(self.storage_label)

        scroll_layout.addStretch()
        scroll.setWidget(scroll_content)
        layout.addWidget(scroll)

        self.setLayout(layout)

    def _update_lang(self):
        """Dil degisikliginde UI metinlerini güncelle"""
        lang = self._manager.lang
        for btn in self.findChildren(QPushButton):
            if btn.objectName() == "refresh_btn":
                btn.setText(lang.get("btn_refresh", "Refresh"))
            elif btn.objectName() == "delete_btn":
                btn.setText(lang.get("btn_delete", "Delete Selected"))
        self._scan_models()

    def _scan_models(self):
        """models/ dizinini tarayıp .gguf dosyalarını listele"""
        self.model_list.clear()

        if not self._models_dir.exists():
            self._models_dir.mkdir(parents=True, exist_ok=True)
            self._update_storage(0, 0)
            return

        gguf_files = []
        total_size = 0

        for root, dirs, files in os.walk(self._models_dir):
            for f in files:
                if f.endswith(".gguf"):
                    full_path = Path(root) / f
                    rel_path = Path(root).relative_to(self._models_dir)
                    size = full_path.stat().st_size
                    gguf_files.append((f, size, rel_path))
                    total_size += size

        if not gguf_files:
            self.model_list.addItem(self._lang.get("label_no_models", "No models found in models/ folder"))
            self._update_storage(0, 0)
            return

        for name, size, rel_path in sorted(gguf_files, key=lambda x: x[0]):
            size_gb = size / (1024 ** 3)
            item_text = f"{name} | {size_gb:.2f} GB | {rel_path}"
            item = QListWidgetItem(item_text)
            item.setData(Qt.ItemDataRole.UserRole, {"name": name, "path": Path(root) / name})
            self.model_list.addItem(item)

        self._update_storage(len(gguf_files), total_size)

    def _update_storage(self, count, total_bytes):
        """Depolama etiketini güncelle"""
        total_gb = total_bytes / (1024 ** 3)
        self.storage_label.setText(
            self._lang.get("label_total_models", "{count} models | {size} GB total")
            .format(count=count, size=f"{total_gb:.1f}")
        )

    def _delete_selected(self):
        """Seçili modelleri sil"""
        selected = self.model_list.selectedItems()
        if not selected:
            return

        # Onay sor
        names = [item.data(Qt.ItemDataRole.UserRole)["name"] for item in selected]
        msg = self._lang.get("confirm_delete", "Delete {name}? This cannot be undone.")
        full_msg = f"Delete {len(names)} model(s)?\n\n" + "\n".join(f"- {n}" for n in names)
        full_msg += "\n\nThis cannot be undone."

        reply = QMessageBox.question(
            self,
            "Confirm Delete",
            full_msg,
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )

        if reply != QMessageBox.StandardButton.Yes:
            return

        # Dosyaları sil
        for item in selected:
            data = item.data(Qt.ItemDataRole.UserRole)
            file_path = data["path"]
            if file_path.exists():
                try:
                    file_path.unlink()
                except Exception as e:
                    pass

        # Listeyi yenile
        self._scan_models()
