# Wan2GP Kurulum Rehberi — NVIDIA RTX 20XX / GTX 16XX (Turing)

> Kaynak: deepbeepmeep/Wan2GP (commit b8b18f81) — `docs/INSTALLATION.md`
> Güncelleme: 2026-10-04 · Desteklenen kartlar: RTX 2080 Ti / 2080 / 2070 / 2060 · GTX 1660 (Ti/Super) / 1650

## Sistem Gereksinimleri

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.11.14** | https://www.python.org/downloads/windows/ |
| Conda | Miniconda (veya Anaconda) | https://www.anaconda.com/download/success?reg=skipped |
| CUDA Toolkit | **13.1** | https://developer.nvidia.com/cuda-13-1-0-download-archive |
| NVIDIA sürücüsü | En güncel Game Ready / Studio (**R580+**, bkz. INT8 notu) | https://www.nvidia.com/drivers |

Bu neslin kendi kuralları (resmî doküman):

- **Triton 3.2 ZORUNLU** (`triton-windows>=3.2,<3.3`) — diğer nesillerden farklı!
- **SageAttention 1.0.6** desteklenen tek Sage sürümüdür (Sage 2 yalnız 30XX+).
- **FlashAttention 2 bu nesli DESTEKLEMEZ** (RTX 30XX+ şartı) → SDPA veya Sage1 kullanın.
- NV FP4 ve Nunchaku bu nesilde yoktur.

## Adım 1 — Clone + sanal ortam

```bash
git clone https://github.com/deepbeepmeep/Wan2GP.git
cd Wan2GP
conda create -n wan2gp python=3.11.14
conda activate wan2gp
```

## Adım 2 — PyTorch (CUDA 13.0 yığını)

```bash
pip install torch==2.10.0 torchvision==0.25.0 torchaudio==2.10.0 --index-url https://download.pytorch.org/whl/cu130
```

## Adım 3 — Bağımlılıklar + hızlandırma kernel'leri

Bu klasördeki `requirements.txt`, taban bağımlılıkları **ve** RTX 20XX kernel'lerini içerir:

```bash
pip install -r requirements.txt
```

| Kernel | Görevi |
|---|---|
| triton-windows ≥3.2,<3.3 | PyTorch compilation için zorunlu (RTX 20XX: 3.2 serisi şartı) |
| Sage Attention 1.0.6 | Video/görüntü üretiminde hız (bu nesil için tek desteklenen Sage) |
| Sparge Attention (spas_sage_attn, post4) | FlashVSR sparse attention |
| GGUF Kernels 1.0.25 | CUDA 13 build'i SM75 (Turing) ve üzerini kapsar; hız karşılaştırmalı seçim RTX 30xx+ kartlarda yapılır. Not: resmî doküman bu wheel'i `pip install --no-deps <url>` ile ayrı kurmayı önerir |
| bitsandbytes 0.49.2 | 4-bit / NF4 checkpoint hızlandırma |

## Adım 4 — Doğrulama

```bash
python -c "import torch; print(torch.__version__); print('CUDA:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0))"
```

## Çalıştırma

```bash
python wgp.py
```

İsteğe bağlı performans değişkenleri (GGUF):

```bat
set WGP_GGUF_LLAMACPP_CUDA_MATMUL_MODE=fast
:: düşük VRAM'de: low_vram
python wgp.py
```

GGUF CUDA paketini tamamen devre dışı bırakmak için: `set WGP_GGUF_LLAMACPP_CUDA=0`.

## INT8 Math Kernels (Comfy Kitchen) — yeni

Yapılandırma menüsündeki **INT8 Math Kernels** seçimi INT8 lineer katmanların backend'ini belirler:
**Auto** (varsayılan; Comfy Kitchen CUDA → Triton → PyTorch sırasıyla dener), Triton, Comfy Kitchen, Disabled.

- Comfy Kitchen `requirements.txt` ile gelir; hazır CUDA kernel'leri **NVIDIA R580+ sürücü** ister.
- Triton INT8/ConvRot optimizasyonları Triton ≥3.3 ister; RTX 20XX'in 3.2 şartı nedeniyle bu nesil standart yolu kullanır.

## İsteğe bağlı: DLSS 5 (Neural Rendering / Frame Generation)

Yeni opsiyonel bileşen — normal kurulumun bir parçası DEĞİLDİR. WanGP'yi kapatıp `scripts\install_dlss5.bat` çalıştırın (pinned SHA-256 kontrolü yapar). Kapalı kaynak üçüncü taraf bileşenler içerir (NVIDIA DLSS runtime, ReShade, RenoDX); kullanmadan önce `docs/DLSS5.md` içindeki lisans/güvenlik uyarılarını ve desteklenen kart listesini okuyun (Frame Generation bu nesilde desteklenmez).

## VRAM ipuçları

- Tarayıcının GPU kullanımını kapatmak 1–5 GB VRAM kazandırır (`scripts/start-chrome-no-gpu.bat`).
- 8–12 GB VRAM'de düşük çözünürlük + düşük VRAM profili kullanın. Uzak LLM motorları (Codex / Claude Code / OpenCode) yerel VRAM kaplamaz — `docs/REMOTE_LLMS.md`.

## Sorun giderme

- `torch.cuda.is_available()` False ise → sürücü + CUDA 13.1 yüklü mü kontrol edin.
- PyTorch 2.8.0 (RAM sızıntısı) ve 2.9.0 (Conv3D performansı) kullanmayın — resmi uyarı.
- Genel sorunlar: https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/TROUBLESHOOTING.md
