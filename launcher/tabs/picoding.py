"""
LLM Runner AIO - Tab 3: Pi Coding
Çalışma dizini yönetimi, Pi Coding terminal açma
"""

import json
import subprocess
from pathlib import Path

from PyQt6.QtWidgets import (
    QVBoxLayout, QHBoxLayout, QPushButton, QLabel,
    QTextEdit, QGroupBox, QFileDialog, QWidget, QMessageBox,
    QLineEdit, QFormLayout
)
from PyQt6.QtCore import Qt
from PyQt6.QtGui import QFont

from app import ROOT, AppManager


class PiCodingTab(QWidget):
    """Tab 3: Pi Coding Agent"""

    def __init__(self):
        super().__init__()
        self._manager = AppManager()
        self._lang = self._manager.lang
        self._config = self._manager.config
        self._working_dir = self._config.get("picoding_path", "")
        self._advisor_config = self._load_advisor_config()

        self._init_ui()
        self._manager.lang.lang_changed.connect(self._update_lang)

    def _init_ui(self):
        layout = QVBoxLayout()
        layout.setContentsMargins(10, 10, 10, 10)
        layout.setSpacing(15)

        # === ÇALIŞMA DİZİNİ ===
        dir_group = QGroupBox(self._lang.get("label_working_dir", "Working Directory"))
        dir_group.setObjectName("dir_group")
        dir_layout = QVBoxLayout()

        # Yol göster
        path_layout = QHBoxLayout()
        self.path_label = QLabel(self._lang.get("label_working_dir", "No path set"))
        self.path_label.setStyleSheet("color: palette(text-muted); font-size: 13px;")
        path_layout.addWidget(self.path_label)
        path_layout.addStretch()
        dir_layout.addLayout(path_layout)

        # Butonlar
        btn_layout = QHBoxLayout()
        
        # Otomatik Bul butonu
        self.detect_btn = QPushButton(self._lang.get("btn_detect_project", "Detect Project"))
        self.detect_btn.clicked.connect(self._detect_project)
        self.detect_btn.setObjectName("detect_btn")
        btn_layout.addWidget(self.detect_btn)

        self.path_btn = QPushButton(self._lang.get("btn_add_to_path", "Add to PATH"))
        self.path_btn.clicked.connect(self._add_to_path)
        self.path_btn.setObjectName("path_btn")
        btn_layout.addWidget(self.path_btn)
        btn_layout.addStretch()
        dir_layout.addLayout(btn_layout)

        dir_group.setLayout(dir_layout)
        layout.addWidget(dir_group)

        # === TALİMATLAR ===
        instr_group = QGroupBox(self._lang.get("label_instructions", "Instructions"))
        instr_group.setObjectName("instr_group")
        instr_layout = QVBoxLayout()

        self.toggle_instr = QPushButton(self._lang.get("label_instructions", "Instructions"))
        self.toggle_instr.setCheckable(True)
        self.toggle_instr.clicked.connect(lambda checked: self.instr_text.setVisible(checked))
        self.toggle_instr.setObjectName("toggle_instr")
        instr_layout.addWidget(self.toggle_instr)

        self.instr_text = QTextEdit()
        self.instr_text.setReadOnly(True)
        self.instr_text.setText(self._lang.get("pi_instructions", "How to use Pi Coding Agent:").replace("\\n", "\n"))
        self.instr_text.setObjectName("instr_text")
        self.instr_text.setMaximumHeight(200)
        self.instr_text.setVisible(False)
        instr_layout.addWidget(self.instr_text)

        instr_group.setLayout(instr_layout)
        layout.addWidget(instr_group)

        # === MCP ADVISOR AYARLARI ===
        advisor_group = QGroupBox(self._lang.get("label_mcp_advisor", "MCP Advisor Settings"))
        advisor_group.setObjectName("advisor_group")
        advisor_layout = QFormLayout()
        advisor_layout.setSpacing(10)

        # URL
        self.advisor_url_input = QLineEdit()
        self.advisor_url_input.setPlaceholderText("http://192.168.1.177:3000/api/chat/completions")
        self.advisor_url_input.setObjectName("advisor_url_input")
        advisor_layout.addRow(self._lang.get("label_advisor_url", "Advisor URL:"), self.advisor_url_input)

        # API Key
        self.advisor_key_input = QLineEdit()
        self.advisor_key_input.setPlaceholderText("eyJhbGciOiJIUzI1NiIs...")
        self.advisor_key_input.setEchoMode(QLineEdit.EchoMode.Password)
        self.advisor_key_input.setObjectName("advisor_key_input")
        advisor_layout.addRow(self._lang.get("label_advisor_key", "API Key:"), self.advisor_key_input)

        # Model Adı
        self.advisor_model_input = QLineEdit()
        self.advisor_model_input.setPlaceholderText("🟢NIM-nvidia.moonshotai/kimi-k2.6")
        self.advisor_model_input.setObjectName("advisor_model_input")
        advisor_layout.addRow(self._lang.get("label_advisor_model", "Model Name:"), self.advisor_model_input)

        # Kaydet Butonu
        self.save_advisor_btn = QPushButton(self._lang.get("btn_save_advisor", "Save Advisor Settings"))
        self.save_advisor_btn.setObjectName("save_advisor_btn")
        self.save_advisor_btn.clicked.connect(self._save_advisor_config)
        advisor_layout.addRow("", self.save_advisor_btn)

        advisor_group.setLayout(advisor_layout)
        layout.addWidget(advisor_group)

        # Ayarları yükle
        self._load_advisor_ui()

        layout.addStretch()

        self.setLayout(layout)

    def _update_lang(self):
        """Dil degisikliginde UI metinlerini güncelle"""
        lang = self._manager.lang
        dir_group_title = self.findChild(QGroupBox, "dir_group")
        if dir_group_title:
            dir_group_title.setTitle(lang.get("label_working_dir", "Working Directory"))
        
        for btn in self.findChildren(QPushButton):
            if btn.objectName() == "detect_btn":
                btn.setText(lang.get("btn_detect_project", "Detect Project"))
            elif btn.objectName() == "path_btn":
                btn.setText(lang.get("btn_add_to_path", "Add to PATH"))
            elif btn.objectName() == "toggle_instr":
                btn.setText(lang.get("label_instructions", "Instructions"))
        
        instr_group = self.findChild(QGroupBox, "instr_group")
        if instr_group:
            instr_group.setTitle(lang.get("label_instructions", "Instructions"))
        
        self.instr_text.setText(lang.get("pi_instructions", "How to use Pi Coding Agent:").replace("\\n", "\n"))

        # MCP Advisor alanlarını güncelle
        advisor_group = self.findChild(QGroupBox, "advisor_group")
        if advisor_group:
            advisor_group.setTitle(lang.get("label_mcp_advisor", "MCP Advisor Settings"))
        
        save_btn = self.findChild(QPushButton, "save_advisor_btn")
        if save_btn:
            save_btn.setText(lang.get("btn_save_advisor", "Save Advisor Settings"))

        # Kaydedilmiş yolu yükle
        if self._working_dir:
            self.path_label.setText(self._working_dir)
        else:
            # Otomatik tespit dene
            self._detect_project()

    def _detect_project(self):
        """Proje dizinini otomatik tespit et"""
        # ROOT dizini (D:/OpenCode/Llm-Runner-aio/) kontrol et
        project_root = ROOT
        
        # Hangi dosyalar projeyi işaret ediyor?
        markers = [
            "package.json",      # Node.js
            "requirements.txt",  # Python
            "pyproject.toml",    # Python
            ".git",              # Git repo
            "CMakeLists.txt",    # CMake
            "launcher",          # Bu projenin kendisi
        ]
        
        found_markers = []
        for marker in markers:
            if (project_root / marker).exists():
                found_markers.append(marker)
        
        if found_markers:
            self._working_dir = str(project_root)
            self.path_label.setText(f"{project_root}\n(Detected: {', '.join(found_markers)})")
            return
        
        # Hiçbir şey bulunamadı, kullanıcıya sor
        directory = QFileDialog.getExistingDirectory(
            self,
            self._lang.get("btn_browse", "Select Working Directory"),
            str(project_root)
        )
        if directory:
            self._working_dir = directory
            self.path_label.setText(directory)

    def _add_to_path(self):
        """picoding klasörünü Windows PATH'e ekle"""
        import winreg
        
        picoding_path = str((ROOT / "picoding").resolve())
        
        try:
            # Kullanıcı onayı
            reply = QMessageBox.question(
                self,
                self._lang.get("btn_add_to_path", "Add to PATH"),
                self._lang.get("msg_confirm_add_path", "Add {} to Windows PATH?\n\nThis will allow you to type 'pi' in any terminal.").format(picoding_path),
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )
            
            if reply == QMessageBox.StandardButton.Yes:
                # PATH'e ekle
                with winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER,
                    r"Environment",
                    0,
                    winreg.KEY_READ | winreg.KEY_WRITE
                ) as key:
                    current_path, _ = winreg.QueryValueEx(key, "Path")
                
                # Zaten ekli mi kontrol et
                if picoding_path in current_path:
                    QMessageBox.information(
                        self,
                        self._lang.get("msg_success", "Success"),
                        self._lang.get("msg_path_already_exists", "Path is already in Windows PATH!")
                    )
                    return
                
                # Yeni PATH
                new_path = picoding_path + ";" + current_path
                
                # Kaydet
                with winreg.OpenKey(
                    winreg.HKEY_CURRENT_USER,
                    r"Environment",
                    0,
                    winreg.KEY_READ | winreg.KEY_WRITE
                ) as key:
                    winreg.SetValueEx(key, "Path", 0, winreg.REG_EXPAND_SZ, new_path)
                
                # Başarı mesajı
                QMessageBox.information(
                    self,
                    self._lang.get("msg_success", "Success"),
                    self._lang.get("msg_path_added", "Successfully added to Windows PATH!\n\nYou can now type 'pi' in any terminal.\n\nNote: You may need to restart your terminal or log out/in for changes to take effect.")
                )
                
                # PATH güncellendi, butonu devre dışı bırak
                self.path_btn.setEnabled(False)
                self.path_btn.setText(self._lang.get("btn_path_added", "Added to PATH"))
                
        except PermissionError:
            QMessageBox.critical(
                self,
                self._lang.get("msg_error", "Error"),
                self._lang.get("msg_permission_denied", "Permission denied. Please run the launcher as Administrator.")
            )
        except Exception as e:
            QMessageBox.critical(
                self,
                self._lang.get("msg_error", "Error"),
                self._lang.get("msg_add_path_failed", "Failed to add to PATH:\n{}\n\nYou can manually add:\n{}\n\nThen restart your terminal.").format(e, picoding_path)
            )

    def _load_advisor_config(self) -> dict:
        """MCP Advisor config dosyasindan ayarlari yükle"""
        config_path = ROOT / "picoding" / "advisor_config.json"
        try:
            if config_path.exists():
                with open(config_path, "r", encoding="utf-8") as f:
                    return json.load(f)
        except Exception:
            pass
        # Varsayılan degerler
        return {
            "url": "http://192.168.1.177:3000/api/chat/completions",
            "key": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFkMGFiYTFkLWY0NDUtNGZhNi1iZDNiLWVlYmM1ZTc4YTgyNCIsImV4cCI6MTc4Mjc5MTg3OCwianRpIjoiMWJkMTRiMTMtMTExMy00ZDlmLWJjY2UtNjMwZjVmNmE4NmNhIiwiaWF0IjoxNzgwMzcyNjc4fQ.lytqEg3Vb-bYU9mEWAi4SxeryUsdN9m40fEEqMJI9zs",
            "model": "🟢NIM-nvidia.moonshotai/kimi-k2.6"
        }

    def _save_advisor_config(self):
        """MCP Advisor ayarlarini kaydet ve mcp_web_reader.py'yi güncelle"""
        url = self.advisor_url_input.text().strip()
        key = self.advisor_key_input.text().strip()
        model = self.advisor_model_input.text().strip()

        if not url or not key or not model:
            QMessageBox.warning(
                self,
                self._lang.get("msg_warning", "Warning"),
                self._lang.get("msg_all_fields_required", "All fields are required!")
            )
            return

        # Config dosyasina kaydet
        config_path = ROOT / "picoding" / "advisor_config.json"
        try:
            with open(config_path, "w", encoding="utf-8") as f:
                json.dump({"url": url, "key": key, "model": model}, f, indent=2, ensure_ascii=False)
        except Exception as e:
            QMessageBox.critical(
                self,
                self._lang.get("msg_error", "Error"),
                self._lang.get("msg_config_save_failed", "Config save failed: {}").format(e)
            )
            return

        # mcp_web_reader.py dosyasini güncelle
        mcp_path = ROOT / "picoding" / "mcp" / "mcp_web_reader.py"
        try:
            with open(mcp_path, "r", encoding="utf-8") as f:
                content = f.read()

            # ADVISOR_URL guncelle
            content = content.replace(
                'ADVISOR_URL = "http://192.168.1.177:3000/api/chat/completions"',
                f'ADVISOR_URL = "{url}"'
            )
            # ADVISOR_KEY guncelle
            content = content.replace(
                'ADVISOR_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpZCI6ImFkMGFiYTFkLWY0NDUtNGZhNi1iZDNiLWVlYmM1ZTc4YTgyNCIsImV4cCI6MTc4Mjc5MTg3OCwianRpIjoiMWJkMTRiMTMtMTExMy00ZDlmLWJjY2UtNjMwZjVmNmE4NmNhIiwiaWF0IjoxNzgwMzcyNjc4fQ.lytqEg3Vb-bYU9mEWAi4SxeryUsdN9m40fEEqMJI9zs"',
                f'ADVISOR_KEY = "{key}"'
            )
            # ADVISOR_MODEL guncelle
            content = content.replace(
                'ADVISOR_MODEL = "🟢NIM-nvidia.moonshotai/kimi-k2.6"',
                f'ADVISOR_MODEL = "{model}"'
            )

            with open(mcp_path, "w", encoding="utf-8") as f:
                f.write(content)

            QMessageBox.information(
                self,
                self._lang.get("msg_success", "Success"),
                self._lang.get("msg_advisor_saved", "Advisor settings saved!\n\n- Config: advisor_config.json\n- MCP: mcp_web_reader.py updated\n\nRestart MCP server for changes to take effect.")
            )

        except Exception as e:
            QMessageBox.critical(
                self,
                self._lang.get("msg_error", "Error"),
                self._lang.get("msg_mcp_update_failed", "Failed to update mcp_web_reader.py:\n{}").format(e)
            )

    def _load_advisor_ui(self):
        """Config dosyasindaki ayarlari UI'ya yükle"""
        self.advisor_url_input.setText(self._advisor_config.get("url", ""))
        self.advisor_key_input.setText(self._advisor_config.get("key", ""))
        self.advisor_model_input.setText(self._advisor_config.get("model", ""))


