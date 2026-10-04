# Wan2GP Kurulum Rehberi — NVIDIA RTX 40XX (Ada)

> Kaynak: deepbeepmeep/Wan2GP (commit b8b18f81) — `docs/INSTALLATION.md`
> Güncelleme: 2026-10-04 · Desteklenen kartlar: RTX 4090 / 4080 (Super) / 4070 Ti (Super) / 4070 (Super) / 4060 Ti / 4060

## Sistem Gereksinimleri

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.11.14** | https://www.python.org/downloads/windows/ |
| Conda | Miniconda (veya Anaconda) | https://www.anaconda.com/download/success?reg=skipped |
| CUDA Toolkit | **13.1** | https://developer.nvidia.com/cuda-13-1-0-download-archive |
| NVIDIA sürücüsü | En güncel Game Ready / Studio (**R580+**, bkz. INT8 notu) | https://www.nvidia.com/drivers |

Not: **NV FP4** (lightx2v) yalnız RTX 50xx/sm120+ içindir — bu nesilde yoktur.

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

Bu klasördeki `requirements.txt`, taban bağımlılıkları **ve** RTX 40XX kernel'lerini içerir:

```bash
pip install -r requirements.txt
```

| Kernel | Görevi |
|---|---|
| triton-windows ≥3.6,<3.7 | PyTorch compilation + Sage Attention için zorunlu (PyTorch 2.10 eşleniği) |
| Sage Attention 2.2.0 (post4) | Video/görüntü üretiminde ~x2 hız |
| Sparge Attention (spas_sage_attn, post4) | FlashVSR sparse attention |
| Flash Attention 2.8.3 | Kalite korur; LM işlerinde (prompt enhancer, TTS, Deepy) belirgin hız |
| GGUF Kernels 1.0.25 | Speculative decoding (MTP/DFlash2/DSpark) INT8 tensor-core doğrulama; WanGP hız karşılaştırmasını RTX 30xx+ kartlarda kendi yapar. Not: resmî doküman bu wheel'i `pip install --no-deps <url>` ile ayrı kurmayı önerir |
| nunchaku 1.2.1 | INT4 quantize desteği (FP4 yalnız 50xx donanımında) |
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
Eski GGUF kernel'ine dönmek (karşılaştırma için): `set LLAMACPP_GGUF_SHORT_BATCH=native`.

## INT8 Math Kernels (Comfy Kitchen) — yeni

Yapılandırma menüsündeki **INT8 Math Kernels** seçimi INT8 lineer katmanların backend'ini belirler:
**Auto** (varsayılan; Comfy Kitchen CUDA → Triton → PyTorch sırasıyla dener), Triton, Comfy Kitchen, Disabled.

- Comfy Kitchen `requirements.txt` ile gelir; hazır CUDA kernel'leri **NVIDIA R580+ sürücü** ister.
- H3 VAE ek fusion'ları (CUDA Kernels Optimized Ops Precision) yalnız doğrulanmış RTX 50-serisi SM120'de devrededir; bu nesil mevcut yolunu korur.

## İsteğe bağlı: DLSS 5 (Neural Rendering / Frame Generation)

Yeni opsiyonel bileşen — normal kurulumun bir parçası DEĞİLDİR. WanGP'yi kapatıp `scripts\install_dlss5.bat` çalıştırın (pinned SHA-256 kontrolü yapar). Kapalı kaynak üçüncü taraf bileşenler içerir (NVIDIA DLSS runtime, ReShade, RenoDX); kullanmadan önce `docs/DLSS5.md` içindeki lisans/güvenlik uyarılarını ve desteklenen kart listesini okuyun.

## VRAM ipuçları

- Tarayıcının GPU kullanımını kapatmak 1–5 GB VRAM kazandırır (`scripts/start-chrome-no-gpu.bat`).
- Yerel Deepy Prime *Qwen3.8 VL 27B* ister (context ≥32000 + Summarize compaction); Speculative Decoding `Auto` 24 GB+ VRAM'de etkinleşir. Daha az VRAM'de: Q2 kuantizasyon + Speculative Decoding kapalı. Uzak LLM motorları (Codex / Claude Code / OpenCode) yerel VRAM kaplamaz — `docs/REMOTE_LLMS.md`.

## Sorun giderme

- `torch.cuda.is_available()` False ise → sürücü + CUDA 13.1 yüklü mü kontrol edin.
- PyTorch 2.8.0 (RAM sızıntısı) ve 2.9.0 (Conv3D performansı) kullanmayın — resmi uyarı.
- Genel sorunlar: https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/TROUBLESHOOTING.md
