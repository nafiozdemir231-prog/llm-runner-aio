# Task: Electron UI Güncellemeleri — duzeltilmesi-gerekenler.txt

## Steps
- [x] 1. System Detection sekmesi güncellemesi
  - INI seçimi + otomatik eşleştirme
  - Download All Models butonu
  - Model listesi gösterimi
  - Download Progress göstergesi
  - Start Configuration (auto-generated INI)
  
- [x] 2. Servers sekmesi güncellemesi
  - Open in Browser butonları eklendi
  - Bind to etiketleri kullanıcı dostu (This PC Only / Local Network)
  - llama.cpp Context Size inputu
  - OpenWebUI CPU Threads inputu
  
- [x] 3. PiCoding sekmesi güncellemesi
  - Working Directory bölümü
  - Detect Project butonu
  - Add to PATH butonu
  - Instructions toggle butonu
  - MCP Advisor Settings (URL, API Key, Model Name)
  
- [x] 4. Models sekmesi güncellemesi
  - Refresh butonu
  - Delete Selected butonu
  - Model count ve total size göstergesi
  
- [x] 5. backend IPC handler'ları
  - picoding-detect-project
  - picoding-add-to-path
  - picoding-save-advisor
  - picoding-get-advisor
  - model-get-models-from-ini
  - model-generate-local-ini
  
- [x] 6. preload.js güncellemesi
  - picoding API'si eklendi
  - model.getModelsFromINI() eklendi
  - model.generateLocalINI() eklendi

## Notes
- PyQt6 referans kodu: D:/OpenCode/LLM-Runner-AIO/LLM-Runner-AIO/launcher/
- Tüm değişiklikler Electron projesine uygulandı
- INI parser için custom parseINI/stringifyINI fonksiyonları yazıldı (no external dependency)
