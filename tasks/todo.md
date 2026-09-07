# Task: wan2gp-presets güncelleme (8681e9f → 057f9eca)

## Tespit edilen farklar (Wan2GP/docs güncel kaynak)
- Base requirements: `mmgp 3.7.12→3.7.14`, yeni: `ultralytics`, `scipy`, `apprise==1.12.0`, `keyring==25.7.0`
- GGUF kernel: **1.0.11 → 1.0.21** (yeni release tag `gguf-v1.0.21`, yeni wheel adları)
  - 1.0.21: RTX50xx (SM120) async-copy Q8 prefill/decode kernel'leri (vLLM otomatik seçer)
  - Yeni env: `WGP_GGUF_LLAMACPP_CUDA=0` (paket devre dışı bırakır)
- Sage: doküman artık **RTX 20XX (Turing) için Sage 1.0.6** tanımlıyor (eski preset "Sage yok" diyordu)
- Yeni opsiyonel özellik: **DLSS5** — `scripts\install_dlss5.bat` (checksum doğrulamalı, kapalı kaynak 3rd-party, CAUTION)
- Deepy: Prime yerel = Qwen3.8 VL 27B + ctx≥32k + Summarize; SpecDec Auto ≥24GB(27B)/≥12GB(9B); uzak motorlar (Codex/Claude/OpenCode) → REMOTE_LLMS.md

## Steps
- [x] 1. Analiz: preset vs güncel docs karşılaştırması
- [x] 2. nvidia requirements.txt ×5 (base + GGUF 1.0.21 + rtx20xx'e Sage 1.0.6)
- [x] 3. nvidia KURULUM.md ×5 (başlık, tablo, DLSS5, env, Deepy notu)
- [x] 4. amd requirements.txt ×4 (sadece base)
- [x] 5. amd KURULUM.md ×4 (sadece başlık commit/tarih)
- [x] 6. intel/arc requirements.txt (base)
- [x] 7. Doğrulama (grep) + tasks/change.md kaydı

## Notes
- Intel KURULUM.md'de tarih/komut satırı YOK → sadece requirements.txt
- AMD index URL'leri güncel dokümanla birebir uyumlu (doğrulandı)
- AMD KURULUM.md gövdeleri güncel AMD-INSTALLATION.md ile uyumlu (rx7xxx tam okundu)
