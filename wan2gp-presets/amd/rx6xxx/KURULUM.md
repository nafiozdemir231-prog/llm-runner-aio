# Wan2GP Kurulum Rehberi — AMD RX 6XXX (RDNA 2)

> Kaynak: deepbeepmeep/Wan2GP (commit b8b18f81) — `docs/AMD-INSTALLATION.md` (TheRock)
> Güncelleme: 2026-10-04
> Desteklenen kartlar (gfx hedefiyle): RX 6950 XT / 6900 XT / 6800 XT / 6800 (**gfx1030**) · RX 6750 XT / 6700 XT (**gfx1031**) · RX 6650 XT / 6600 XT / 6600 (**gfx1032**) · RX 6500 XT (**gfx1034**)

## ⚠️ Eski ROCm ortamı varsa DEĞİŞTİRİN + beklenti notu

- Önceki preset'lerdeki `rocm.nightlies.amd.com/v2-staging/gfx103X-dgpu` index'i ve `rocm65` ortamları **artık kullanılmıyor**; kurulum **stable** TheRock index'i ile yapılmalı.
- **RDNA 2'de PyTorch'un flash attention kernel'i yok** → attention RDNA3 ve yenilerine göre belirgin yavaş çalışır (resmî doküman uyarısı). Staging/nightly kanalı gerekmez; stable index kullanın.

## Sistem Gereksinimleri

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.12** (ROCm index'i NumPy wheel'ini yalnız 3.12+ için yayımlar) | https://www.python.org/downloads/windows/ |
| Git | en güncel | https://git-scm.com/install/windows |
| AMD sürücüsü | En güncel Adrenalin | https://www.amd.com/en/support/download/drivers.html |

Kartınızın gfx hedefini doğrulamak için: `clinfo | findstr gfx` (clinfo, AMD sürücüsüyle gelir).

## Adım 1 — Clone + venv

```bat
git clone https://github.com/deepbeepmeep/Wan2GP.git
cd Wan2GP
py -3.12 -m venv wan2gp-env
wan2gp-env\Scripts\activate
```

## Adım 2 — ROCm/PyTorch (TheRock stable)

Kartinizin hedefiyle (gfx1030 örneği):

```bat
pip install "torch[device-gfx1030]==2.13.0+rocm10.0.0" "torchvision[device-gfx1030]==0.28.0+rocm10.0.0" torchaudio==2.11.0.2+rocm10.0.0 --index-url https://stable.repo.amd.com/rocm/whl-next/
```

- gfx1031 / gfx1032 / gfx1034 için ilgili etiketi kullanın.
- `--index-url` AYNEN böyle kalmalı; `--extra-index-url` kullanırsanız pip CPU-only torch'u seçer.
- ROCm runtime bağımlılık olarak otomatik gelir. Birden fazla AMD GPU varsa hedefleri listeleyin: `torch[device-gfx1032,device-gfx1034]`.

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
Device: AMD Radeon RX 6800 XT
```

Sürüm `+rocm...` ile bitmiyorsa CPU-only build kurulmuştur → Adım 2'yi tekrarlayın.

## Attention modları

- **SDPA (varsayılan):** RDNA2'de flash attention kernel'i bulunmaz; standart SDPA yolu kullanılır (görece yavaş — beklentiyi buna göre ayarlayın).
- **SageAttention 1** (Triton gerektirir):
  ```bat
  pip install -U "triton-windows>=3.7,<3.8"
  pip install sageattention==1.0.6
  ```
  triton-windows 3.7, PyTorch 2.13 ile eşleşir ve ROCm SDK'yı aktif ortamdan bulur — Visual Studio / `rocm-sdk init` / ek ortam değişkeni GEREKMEZ (eski rehberdeki vcvars adımları artık geçersiz).

## INT8 Math Kernels (Comfy Kitchen) — yeni

**INT8 Math Kernels** menüsü (varsayılan **Auto**): RDNA2'de Kitchen HIP desteklenmez → WanGP otomatik olarak Triton, sonra PyTorch fallback'ini kullanır. Ek kurulum gerekmez.

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

- `torch.cuda.is_available()` False → kart destek listesinde mi, `device-gfx...` hedefi `clinfo | findstr gfx` çıktısıyla birebir aynı mı; Adrenalin sürücüsünü güncelleyin.
- "No solution found / Could not find a version" → venv Python 3.12 mi (`python --version`), hedef adı doğru yazılmış mı (`device-gfx1030`, `device-gfx103X` değil).
- "No matching distribution found" → mimari Windows için yayımlanmamış veya venv aktif değil.
- ROCm wheel bilinen sorunları: https://github.com/ROCm/TheRock/issues/808 · WanGP genel: `docs/TROUBLESHOOTING.md`
