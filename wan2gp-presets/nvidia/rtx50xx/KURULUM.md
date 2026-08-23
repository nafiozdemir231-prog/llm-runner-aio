# Wan2GP Kurulum Rehberi — NVIDIA RTX 50XX (Blackwell)

> Kaynak: deepbeepmeep/Wan2GP (commit 8681e9f) — `docs/INSTALLATION.md`
> Güncelleme: 2026-08-23 · Desteklenen kartlar: RTX 5090 / 5080 / 5070 Ti / 5070

## Sistem Gereksinimleri

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.11.14** | https://www.python.org/downloads/windows/ |
| Conda | Miniconda (veya Anaconda) | https://www.anaconda.com/download/success?reg=skipped |
| CUDA Toolkit | **13.1** | https://developer.nvidia.com/cuda-13-1-0-download-archive |
| NVIDIA sürücüsü | En güncel Game Ready / Studio | https://www.nvidia.com/drivers |

RTX 50XX aynı zamanda **NV FP4** kernel desteği sunar (sm120+) — bu pakete dahildir.

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

Bu klasördeki `requirements.txt`, taban bağımlılıkları **ve** RTX 50XX kernel'lerini içerir:

```bash
pip install -r requirements.txt
```

| Kernel | Görevi |
|---|---|
| triton-windows | PyTorch compilation + Sage Attention için zorunlu |
| Sage Attention 2.2.0 (post4) | Video/görüntü üretiminde ~x2 hız |
| Sparge Attention (spas_sage_attn) | FlashVSR sparse attention |
| Flash Attention 2.8.3 | Kalite korur; LM işlerinde (prompt enhancer, TTS, Deepy) belirgin hız |
| GGUF Kernels 1.0.11 | GGUF modeller için CUDA hızlandırma (Stream-K, FP16/BF16 matmul) |
| lightx2v_kernel 0.0.2 | **NV FP4** dequantization (yalnız 50xx/sm120+) |
| nunchaku 1.2.1 | INT4/FP4 quantize desteği |
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

Sol-Attn (Advanced Mode → Misc → Override Attention Mode) bu nesilde ~%30'a varan kazanım verebilir (BF16 + Triton 3.6+ gerekir).

## VRAM ipuçları

- Tarayıcının GPU kullanımını kapatmak 1–5 GB VRAM kazandırır (`scripts/start-chrome-no-gpu.bat`).
- Deepy Prime varsayılan olarak 24 GB ister; *Qwen3.8 VL 27B GGUF Q2* + *max 32000 KV Cache* + *Speculative Decoding kapalı* + tarayıcı no-GPU moduyla 16 GB'a iner.

## Sorun giderme

- `torch.cuda.is_available()` False ise → sürücü + CUDA 13.1 yüklü mü kontrol edin.
- PyTorch 2.8.0 (RAM sızıntısı) ve 2.9.0 (Conv3D performansı) kullanmayın — resmi uyarı.
- Genel sorunlar: https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/TROUBLESHOOTING.md
