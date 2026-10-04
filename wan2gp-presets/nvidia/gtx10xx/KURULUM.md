# Wan2GP Kurulum Rehberi — NVIDIA GTX 10XX (Pascal)

> Kaynak: deepbeepmeep/Wan2GP (commit b8b18f81) — `docs/INSTALLATION.md`
> Güncelleme: 2026-10-04 · Desteklenen kartlar: GTX 1080 Ti / 1080 / 1070 / 1060

## ⚠️ Bu nesil AYRI bir yazılım yığında çalışır!

Resmî dokümana göre GTX 10XX için test edilmiş stabil yapı **eski yığındır**:

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.10.9** | https://www.python.org/downloads/windows/ |
| Conda | Miniconda (veya Anaconda) | https://www.anaconda.com/download/success?reg=skipped |
| CUDA Toolkit | **12.8** | https://developer.nvidia.com/cuda-12-8-0-download-archive |
| NVIDIA sürücüsü | En güncel Game Ready / Studio | https://www.nvidia.com/drivers |

Diğer nesillerden farklar:

- PyTorch **2.7.1 + cu128-test** (cu130 değil!)
- **Sage Attention GTX 10xx'i desteklemez** → pakette yok (resmî uyarı)
- triton-windows ve bitsandbytes bu yığın için belgelendirilmemiş → pakette yok
  (ConvRot optimizasyonları Triton ≥3.3 ister; gerekirse `pip install -U "triton-windows>=3.3,<3.4"` — belgelenmemiş, kendi riskiniz)
- Nunchaku INT4 1.2.0 (bu yığının kendi wheel'i)

## Adım 1 — Clone + sanal ortam

```bash
git clone https://github.com/deepbeepmeep/Wan2GP.git
cd Wan2GP
conda create -n wan2gp python=3.10.9
conda activate wan2gp
```

## Adım 2 — PyTorch (CUDA 12.8 TEST yığını)

```bash
pip install torch==2.7.1 torchvision==0.22.1 torchaudio==2.7.1 --index-url https://download.pytorch.org/whl/test/cu128
```

## Adım 3 — Bağımlılıklar + hızlandırma kernel'leri

Bu klasördeki `requirements.txt`, taban bağımlılıkları **ve** GTX 10XX kernel'lerini içerir:

```bash
pip install -r requirements.txt
```

| Kernel | Görevi |
|---|---|
| Sparge Attention (spas_sage_attn, cu128/torch2.7.1 build) | FlashVSR sparse attention |
| Flash Attention 2.7.4.post1 (cu128/torch2.7.0 build) | Kalite korur; LM işlerinde belirgin hız |
| GGUF Kernels 1.0.25 (torch271/cu128/py310 build) | GGUF modeller için CUDA hızlandırma (CUDA 12.8 build'i pre-SM75 kodunu da içerir). Not: resmî doküman bu wheel'i `pip install --no-deps <url>` ile ayrı kurmayı önerir |
| nunchaku 1.2.0 (torch2.7/cu128 build) | INT4 quantize desteği |

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
Bu eski yığında Kitchen/Triton bulunamazsa WanGP otomatik olarak standart PyTorch/Quanto yoluna düşer — kurulum ek bir adım gerektirmez.

## VRAM ipuçları

- 6–11 GB VRAM için düşük çözünürlük + düşük VRAM profili kullanın.
- Tarayıcının GPU kullanımını kapatmak 1–5 GB VRAM kazandırır (`scripts/start-chrome-no-gpu.bat`).

## Sorun giderme

- `torch.cuda.is_available()` False ise → sürücü + CUDA 12.8 yüklü mü kontrol edin.
- Bu nesil için PyTorch 2.10/cu130 yığını **tavsiye edilmez** — resmî testler eski yığın üzerinden yapılıyor.
- Genel sorunlar: https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/TROUBLESHOOTING.md
