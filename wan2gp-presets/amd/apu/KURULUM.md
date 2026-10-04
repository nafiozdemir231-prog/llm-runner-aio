# Wan2GP Kurulum Rehberi — AMD APU (dahili GPU: RDNA 3.5 / RDNA 3 / RDNA 2)

> Kaynak: deepbeepmeep/Wan2GP (commit b8b18f81) — `docs/AMD-INSTALLATION.md` (TheRock)
> Güncelleme: 2026-10-04
> Desteklenen APU'lar (gfx hedefiyle):
> - **Ryzen AI Max / Strix Halo** (gfx1151) · **Radeon 890M / 880M** — Ryzen AI 9 HX 370 / 375 (gfx1150)
> - **Ryzen AI 7 350** (gfx1152) · **Radeon 820M** (gfx1153)
> - **Radeon 780M / 760M** — Ryzen 7040/8040 serisi (gfx1103) · **Radeon 680M** (gfx1035)

## ⚠️ Eski ROCm ortamı varsa DEĞİŞTİRİN

Önceki preset'lerdeki `rocm.nightlies.amd.com/v2(-staging)/gfx...` index'leri **artık kullanılmıyor**; kurulum **stable** TheRock index'i ile yapılmalı.
Dahili GPU'da VRAM sistem RAM'inden paylaşımdır — bütçe RAM ne kadar yüksekse (özellikle Strix Halo) o kadar rahat çalışır.

## Sistem Gereksinimleri

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.12** (ROCm index'i NumPy wheel'ini yalnız 3.12+ için yayımlar) | https://www.python.org/downloads/windows/ |
| Git | en güncel | https://git-scm.com/install/windows |
| AMD sürücüsü | En güncel Adrenalin | https://www.amd.com/en/support/download/drivers.html |

APU'nuzun gfx hedefini doğrulamak için: `clinfo | findstr gfx` (clinfo, AMD sürücüsüyle gelir).

## Adım 1 — Clone + venv

```bat
git clone https://github.com/deepbeepmeep/Wan2GP.git
cd Wan2GP
py -3.12 -m venv wan2gp-env
wan2gp-env\Scripts\activate
```

## Adım 2 — ROCm/PyTorch (TheRock stable)

APU'nuzun hedefiyle (gfx1150 örneği):

```bat
pip install "torch[device-gfx1150]==2.13.0+rocm10.0.0" "torchvision[device-gfx1150]==0.28.0+rocm10.0.0" torchaudio==2.11.0.2+rocm10.0.0 --index-url https://stable.repo.amd.com/rocm/whl-next/
```

- gfx1151 / gfx1152 / gfx1153 / gfx1103 / gfx1035 için ilgili etiketi kullanın.
- Harici ekran kartı + APU bir aradaysa HERİKİ hedefi de yazın: `torch[device-gfx1103,device-gfx1201]` (vision için örnek).
- `--index-url` AYNEN böyle kalmalı; `--extra-index-url` kullanırsanız pip CPU-only torch'u seçer.

## Adım 3 — Bağımlılıklar

Bu klasördeki `requirements.txt` yalnızca taban bağımlılıklardır (torch kasıtlı olarak dışarıda — Adım 2'de geldi):

```bat
pip install -r requirements.txt
```

## Adım 4 — Doğrulama

```bat
python -c "import torch; print('PyTorch:', torch.__version__); print('GPU available:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No GPU')"
```

Beklenen çıktı örneği:
```
PyTorch: 2.13.0+rocm10.0.0
GPU available: True
Device: AMD Radeon 890M
```

Sürüm `+rocm...` ile bitmiyorsa CPU-only build kurulmuştur → Adım 2'yi tekrarlayın.

## Attention modları

- **SDPA (varsayılan):** RDNA3/3.5 AOTriton flash attention kernel'leri kullanır; deneysel işaretli olanları `wgp.py` otomatik etkinleştirir (`TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL=1`). gfx1035 (RDNA2) hariç.
- **SageAttention 1** (Triton gerektirir):
  ```bat
  pip install -U "triton-windows>=3.7,<3.8"
  pip install sageattention==1.0.6
  ```
  triton-windows 3.7, PyTorch 2.13 ile eşleşir ve ROCm SDK'yı aktif ortamdan bulur — Visual Studio / `rocm-sdk init` / ek ortam değişkeni GEREKMEZ (eski rehberdeki vcvars adımları artık geçersiz).

## INT8 Math Kernels (Comfy Kitchen) — yeni

**INT8 Math Kernels** menüsü (varsayılan **Auto**): RDNA3/3.5 iGPU'larda Kitchen'ın **HIP** extension'ı denenir, olmazsa Triton → PyTorch'a düşer. gfx1035 (RDNA2) doğrudan Triton/PyTorch fallback kullanır.

## Çalıştırma

```bat
cd \path-to\Wan2GP
wan2gp-env\Scripts\activate
python wgp.py
```

İlk kullanımda VAE encode/decode yavaşsa MIOpen kernel benchmark yapıyordur:

```bat
set MIOPEN_FIND_MODE=FAST
```

## Sorun giderme

- `torch.cuda.is_available()` False → APU destek listesinde mi, `device-gfx...` hedefi `clinfo | findstr gfx` çıktısıyla birebir aynı mı; Adrenalin sürücüsünü güncelleyin.
- "No solution found / Could not find a version" → venv Python 3.12 mi (`python --version`), hedef adı doğru yazılmış mı (`device-gfx1150`, `device-gfx115X` değil).
- "No matching distribution found" → mimari Windows için yayımlanmamış veya venv aktif değil.
- Düşük RAM'li APU sistemlerde üretim süresi uzun olabilir; düşük çözünürlük + kısa süreyle başlayın.
- ROCm wheel bilinen sorunları: https://github.com/ROCm/TheRock/issues/808 · WanGP genel: `docs/TROUBLESHOOTING.md`
