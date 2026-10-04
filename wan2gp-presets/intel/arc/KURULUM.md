# Wan2GP Kurulum Rehberi — Intel Arc (A / B serisi)

> ⚠️⚠️ UYARI — RESMÎ DESTEK DEĞİL! ⚠️⚠️
>
> deepbeepmeep/Wan2GP resmen **SADECE NVIDIA (CUDA)** ve **AMD (ROCm/TheRock)**
> GPU'larını destekler. Repo dokümanlarında (README, docs/*.md) Intel için
> **hiçbir resmî talimat YOKTUR** (commit b8b18f81'de de yoktur).
>
> Bu paket, toplulukta yaygın kullanılan **DirectML** (`torch-directml`) yöntemiyle
> hazırlanmıştır. Beklentileri buna göre ayarlayın:
> - Performans, aynı işi CUDA/ROCm'de yapana göre belirgin şekilde geridedir
> - Tüm NVIDIA kernel'leri (Sage/Sparge/FlashAttn/GGUF-CUDA/NV-FP4/bitsandbytes) **kullanılamaz**
> - Bazı özellikler (özellikle CUDA varsayan eklentiler) hatalı davranabilir
> - Resmî sorun giderme dokümanı bu paketi kapsamaz

## Desteklenen kartlar (topluluk geri bildirimiyle)

- Arc A serisi (Alchemist): A750, A770, A380 vb.
- Arc B serisi (Battlemage): B580, B570, B5700 vb.
- Daha eski Intel iGPU/dGPU için garanti verilmez

## Sistem Gereksinimleri

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.11** (64-bit) | https://www.python.org/downloads/windows/ |
| Git | en güncel | https://git-scm.com/install/windows |
| Intel sürücüsü | En güncel Arc Graphics driver | https://www.intel.com/content/www/us/download/graphics.html |

## Adım 1 — Clone + venv

```bat
git clone https://github.com/deepbeepmeep/Wan2GP.git
cd Wan2GP
python -m venv wan2gp-env
wan2gp-env\Scripts\activate
```

Birden fazla Python sürümünüz varsa: `py -3.11 -m venv wan2gp-env`

## Adım 2 — DirectML backend kurulumu

Bu klasördeki `requirements.txt` başında `torch-directml` yer alır; ayrıca tek komutla da kurulabilir:

```bat
pip install torch-directml
```

(`torch-directml`, Microsoft'un PyTorch + DirectML yamasıdır; `torch` paketini de birlikte kurar.)

## Adım 3 — Bağımlılıklar

```bat
pip install -r requirements.txt
```

## Adım 4 — Doğrulama

```bat
python -c "import torch; print(torch.__version__); print('GPU sayisi:', torch.cuda.device_count()); print('Cihaz:', torch.cuda.get_device_name(0))"
```

DirectML'de cihaz adının Intel Arc olarak gelmesi beklenir.

## Çalıştırma

```bat
python wgp.py
```

Not: **INT8 Math Kernels** menüsü bu kurulumda **Disabled (PyTorch)** gibi davranır — Comfy Kitchen CUDA/HIP ve Triton backend'leri DirectML ortamında bulunmaz; WanGP standart PyTorch/Quanto yolunu kullanır.

## VRAM / performans ipuçları

- Düşük çözünürlük ve kısa süreli üretimlerle başlayın; DirectML bellek yönetimi CUDA kadar verimli değildir.
- Tarayıcının GPU kullanımını kapatmak 1–5 GB VRAM kazandırır (`scripts/start-chrome-no-gpu.bat`).

## Sorun giderme

- Doğrulama adımı GPU göstermiyorsa: Intel sürücüsünü güncelleyin, venv'in aktif olduğundan emin olun.
- `torch-directml` güncellemeleri yavaştır; pip'in kurduğu sürümde açık bir uyumsuzluk görürseniz issues'dan raporlayın.
- Genel WanGP sorunları: https://github.com/deepbeepmeep/Wan2GP/blob/main/docs/TROUBLESHOOTING.md (Intel'e özel resmî destek yoktur)
