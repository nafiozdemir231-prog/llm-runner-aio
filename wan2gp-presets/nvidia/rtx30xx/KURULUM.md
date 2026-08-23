# Wan2GP Kurulum Rehberi — NVIDIA RTX 30XX (Ampere)

> Kaynak: deepbeepmeep/Wan2GP (commit 8681e9f) — `docs/INSTALLATION.md`
> Güncelleme: 2026-08-23 · Desteklenen kartlar: RTX 3090 / 3080 Ti / 3080 / 3070 / 3060

## Sistem Gereksinimleri

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.11.14** | https://www.python.org/downloads/windows/ |
| Conda | Miniconda (veya Anaconda) | https://www.anaconda.com/download/success?reg=skipped |
| CUDA Toolkit | **13.1** | https://developer.nvidia.com/cuda-13-1-0-download-archive |
| NVIDIA sürücüsü | En güncel Game Ready / Studio | https://www.nvidia.com/drivers |

**NESİL FARKLARI (RTX 40XX'e göre):**
- triton-windows sürümü **<3.3** olmalı (resmi talimat: `pip install -U "triton-windows<3.3"`)
- RTX 30XX için desteklenen tek Sage sürümü **Sage Attention 1** (`sageattention==1.0.6`) — Sage 2 YOK
- NV FP4 kernel'leri YOK (yalnız 50xx)

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

Bu klasördeki `requirements.txt`, taban bağımlılıkları **ve** RTX 30XX kernel'lerini içerir:

```bash
pip install -r requirements.txt
```

| Kernel | Görevi |
|---|---|
| triton-windows <3.3 | PyTorch compilation + Sage Attention (20XX/30XX için surumlu sürüm) |
| Sage Attention 1.0.6 | Video/görüntü hızlandırma (30XX'teki tek desteklenen Sage) |
| Sparge Attention (spas_sage_attn) | FlashVSR sparse attention |
| Flash Attention 2.8.3 | Kalite korur; LM işlerinde belirgin hız |
| GGUF Kernels 1.0.11 | GGUF modeller için CUDA hızlandırma (Stream-K, FP16/BF16 matmul) |
| bitsandbytes 0.49.2 | 4-bit / NF4 checkpoint hızlandırma |

## Adım 4 — Doğrulama

```bash
python -c "import torch; print(torch.__version__); print('CUDA:', torch.cuda.is_available()); print('GPU:', torch.cuda.get_device_name(0))"
```

## Çalıştırma

```bash
python wgp.py
```

## VRAM ipuçları

- Tarayıcının GPU kullanımını kapatmak 1–5 GB VRAM kazandırır (`scripts/start-chrome-no-gpu.bat`).
- Düşük VRAM'de (8–12 GB) GGUF kuantize modeller + düşük çözünürlük tercih edin.

## Sorun giderme

- `torch.cuda.is_available()` False ise → sürücü + CUDA 13.1 yüklü mü kontrol edin.
- PyTorch 2.8.0 (RAM sızıntısı) ve 2.9.0 (Conv3D performansı) kullanmayın — resmi uyarı.
- Genel sorunlar: https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/TROUBLESHOOTING.md
