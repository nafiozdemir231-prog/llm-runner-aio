# Wan2GP Kurulum Rehberi — NVIDIA RTX 20XX / GTX 16XX (Turing)

> Kaynak: deepbeepmeep/Wan2GP (commit 8681e9f) — `docs/INSTALLATION.md`
> Güncelleme: 2026-08-23 · Desteklenen kartlar: RTX 2080 Ti / 2080 / 2070 Super / 2070 / 2060 / GTX 1660 / 1650 / 1630

## Sistem Gereksinimleri

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.11.14** | https://www.python.org/downloads/windows/ |
| Conda | Miniconda (veya Anaconda) | https://www.anaconda.com/download/success?reg=skipped |
| CUDA Toolkit | **13.1** | https://developer.nvidia.com/cuda-13-1-0-download-archive |
| NVIDIA sürücüsü | En güncel Game Ready / Studio | https://www.nvidia.com/drivers |

Resmi dokümanda bu nesil "RTX 20xx – RTX 50xx" grubunda, yani yeni Python 3.11 / PyTorch 2.10 / CUDA 13 yığında yer alır.

**NESİL FARKLARI (RTX 30XX'e göre):**
- `docs/INSTALLATION.md` bu nesil için **Sage Attention tanımaz** (Sage 1 yalnız 30XX+, Sage 2 yalnız 40XX+) → pakette Sage YOK
- triton-windows yine **<3.3** surumu
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

Bu klasördeki `requirements.txt`, taban bağımlılıkları **ve** bu nesle ait kernel'leri içerir:

```bash
pip install -r requirements.txt
```

| Kernel | Görevi |
|---|---|
| triton-windows <3.3 | PyTorch compilation (20XX/30XX için surumlu sürüm) |
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

- Bu nesilde VRAM genelde 6–8 GB olduğundan GGUF kuantize modeller ve düşük çözünürlükler önerilir.
- Tarayıcının GPU kullanımını kapatmak 1–5 GB VRAM kazandırır (`scripts/start-chrome-no-gpu.bat`).

## Sorun giderme

- `torch.cuda.is_available()` False ise → sürücü + CUDA 13.1 yüklü mü kontrol edin.
- PyTorch 2.8.0 (RAM sızıntısı) ve 2.9.0 (Conv3D performansı) kullanmayın — resmi uyarı.
- Genel sorunlar: https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/TROUBLESHOOTING.md
