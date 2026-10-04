# Wan2GP Kurulum Rehberi — AMD RX 9XXX (RDNA 4)

> Kaynak: deepbeepmeep/Wan2GP (commit b8b18f81) — `docs/AMD-INSTALLATION.md` (TheRock)
> Güncelleme: 2026-10-04
> Desteklenen kartlar: RX 9070 XT / RX 9070 / Radeon AI PRO R9700 (gfx1201) · RX 9060 XT / RX 9060 (gfx1200)

## ⚠️ Eski ROCm ortamı varsa DEĞİŞTİRİN

Önceki preset'lerdeki `rocm.nightlies.amd.com/v2/gfx...` index'leri ve `rocm65` ortamları **artık kullanılmıyor**.
Yeni kurulum **stable** TheRock index'i ile yapılmalı: eski ortamı bırakıp yeni ortam oluşturun (`install.bat` ile otomatik, veya aşağıdaki adımlarla elle).

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

```bat
pip install "torch[device-gfx1201]==2.13.0+rocm10.0.0" "torchvision[device-gfx1201]==0.28.0+rocm10.0.0" torchaudio==2.11.0.2+rocm10.0.0 --index-url https://stable.repo.amd.com/rocm/whl-next/
```

- **RX 9060 XT / RX 9060** için `device-gfx1200` kullanın.
- `--index-url` AYNEN böyle kalmalı; `--extra-index-url` kullanırsanız pip CPU-only torch'u seçer.
- ROCm runtime bağımlılık olarak otomatik gelir. Birden fazla AMD GPU varsa hedefleri listeleyin: `torch[device-gfx1200,device-gfx1201]`.

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
Device: AMD Radeon RX 9070 XT
```

Sürüm `+rocm...` ile bitmiyorsa CPU-only build kurulmuştur → Adım 2'yi tekrarlayın.

## Attention modları

- **SDPA (varsayılan):** RDNA3+ AOTriton flash attention kernel'leri kullanır; deneysel işaretli olanları `wgp.py` otomatik etkinleştirir (`TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL=1`).
- **SageAttention 1** (Triton gerektirir):
  ```bat
  pip install -U "triton-windows>=3.7,<3.8"
  pip install sageattention==1.0.6
  ```
  triton-windows 3.7, PyTorch 2.13 ile eşleşir ve ROCm SDK'yı aktif ortamdan bulur — Visual Studio / `rocm-sdk init` / ek ortam değişkeni GEREKMEZ (eski rehberdeki vcvars adımları artık geçersiz).
- **FlashAttention-2** (aiter Triton kernel'leri, kaynak derlemesi; derleme sırasında Visual Studio gerekmez):
  ```bat
  git clone https://github.com/Dao-AILab/flash-attention.git
  cd flash-attention
  set FLASH_ATTENTION_TRITON_AMD_ENABLE=TRUE
  pip install --no-build-isolation .
  ```
  Kurulumda bir kez "Triton implementation'a düşüyor" uyarı çıkması normaldir.

## INT8 Math Kernels (Comfy Kitchen) — yeni

**INT8 Math Kernels** menüsü (varsayılan **Auto**): AMD'de RDNA3/3.5/4 cihazlarda Kitchen'ın **HIP** extension'ını dener, olmazsa Triton → PyTorch'a düşer. RDNA2 bu yolda Triton/PyTorch fallback'i korur.

## Deneysel: GGUF CUDA HIP wheel (yalnız RX 9070 serisi / gfx1201)

Ayrı bir deney ortamı ister — ana ROCm ortamınızla (torch 2.13+rocm10) **UYUMLU DEĞİLDİR**, farklı bir ortam kurun:

```powershell
python -m pip install --index-url https://repo.amd.com/rocm/whl-multi-arch/ "torch[device-gfx1201]==2.10.0+rocm7.14.0" "rocm[libraries,device-gfx1201]==7.14.0"
python -m pip install --no-deps https://github.com/deepbeepmeep/kernels/releases/download/gguf-v1.0.25/llamacpp_gguf_cuda-1.0.25%2Btorch210rocm714py311-cp311-cp311-win_amd64.whl
```

Wheel farklı bir PyTorch build'inde import edilmeyi reddeder. Donanımsal doğrulama hâlâ bekleniyor — deneysel olarak değerlendirin.

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
- "No solution found / Could not find a version" → venv Python 3.12 mi (`python --version`), hedef adı doğru yazılmış mı (`device-gfx1201`, `device-gfx120X` değil).
- "No matching distribution found" → mimari Windows için yayımlanmamış veya venv aktif değil.
- ROCm wheel bilinen sorunları: https://github.com/ROCm/TheRock/issues/808 · WanGP genel: `docs/TROUBLESHOOTING.md`
