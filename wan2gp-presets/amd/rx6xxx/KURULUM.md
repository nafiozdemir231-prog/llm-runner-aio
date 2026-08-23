# Wan2GP Kurulum Rehberi — AMD RX 6XXX (RDNA 2)

> Kaynak: deepbeepmeep/Wan2GP (commit 8681e9f) — `docs/AMD-INSTALLATION.md` (TheRock)
> Güncelleme: 2026-08-23
> Desteklenen aile (gfx103X-dgpu): RDNA 2 dGPU serisi (RX 6000 serisi vb.)

## ⚠️ Staging kanalı

RDNA 2 için TheRock wheel'leri **staging** kanalındadır (ön-yayın). Sürümler daha sık değişebilir; kurulumdan önce https://github.com/ROCm/TheRock/blob/main/SUPPORTED_GPUS.md matrisine bakmanız önerilir.

## Sistem Gereksinimleri

| Öğe | Gerekli sürüm | Nereden |
|---|---|---|
| İşletim sistemi | Windows 10/11 (64-bit) | — |
| Python | **3.11** (TheRock: 3.11/3.12/3.13 destekler) | https://www.python.org/downloads/windows/ |
| Git | en güncel | https://git-scm.com/install/windows |
| AMD sürücüsü | En güncel Adrenalin | https://www.amd.com/en/support |

PyTorch, AMD özelinde **TheRock** projesinin resmi ROCm-Windows wheel'leriyle kurulur (ROCm = AMD'nin CUDA karşılığı).

## Adım 1 — Clone + venv

```bat
git clone https://github.com/deepbeepmeep/Wan2GP.git
cd Wan2GP
python -m venv wan2gp-env
wan2gp-env\Scripts\activate
```

Birden fazla Python sürümünüz varsa: `py -3.11 -m venv wan2gp-env`

## Adım 2 — ROCm/PyTorch (TheRock) — RDNA 2 index (STAGING)

**Index URL'ini kart ailenize göre doğru seçmek kritik:**

```bat
pip install --pre torch torchaudio torchvision rocm[devel] --index-url https://rocm.nightlies.amd.com/v2-staging/gfx103X-dgpu/
```

## Adım 3 — Bağımlılıklar

Bu klasördeki `requirements.txt` yalnızca taban bağımlılıklardır (torch kasıtlı olarak dışarıda — Adım 2'de geldi):

```bat
pip install -r requirements.txt
```

## Adım 4 — Doğrulama

```bat
python -c "import torch; print('PyTorch:', torch.__version__); print('ROCm available:', torch.cuda.is_available()); print('Device:', torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'No GPU')"
```

## İsteğe bağlı: Attention modları (hızlandırma)

Wan2GP, [triton-windows](https://github.com/woct0rdho/triton-windows/) üzerinden birden çok attention sunabilir. Önce:

```bat
pip uninstall triton
pip install triton-windows
rocm-sdk init
"C:\Program Files\Microsoft Visual Studio\2022\Community\VC\Auxiliary\Build\vcvars64.bat" >nul 2>&1
```

- **SDPA Flash** — PyTorch'ta varsayılan, ek kurulum gerektirmez (RDNA2+ AOTriton ile)
- **SageAttention V1** — `.post26` veya yenisi gerekir:
  ```bat
  pip install "sageattention <2"
  ```
  (Triton derleme sorunu düzeltmeli wheel: https://github.com/Comfy-Org/wheels/actions/runs/21343435018 )
- **FlashAttention-2** (yalnız Triton backend, kaynak derlemesi):
  ```bat
  git clone https://github.com/Dao-AILab/flash-attention.git
  cd flash-attention
  pip install ninja
  pip install packaging
  set FLASH_ATTENTION_TRITON_AMD_ENABLE=TRUE && python setup.py install
  ```

## Çalıştırma — her oturumda gerekli ortam değişkenleri

Her yeni CMD oturumunda (venv aktifken) şu değişkenleri ayarlayıp `wgp.py` çalıştırın — kalıcı çözüm için hepsini tek `.bat` dosyasına alın:

```bat
set ROCM_HOME=%ROCM_ROOT%
set PATH=%ROCM_ROOT%\lib\llvm\bin;%ROCM_BIN%;%PATH%
set CC=clang-cl
set CXX=clang-cl
set DISTUTILS_USE_SDK=1
set FLASH_ATTENTION_TRITON_AMD_ENABLE=TRUE
set TORCH_ROCM_AOTRITON_ENABLE_EXPERIMENTAL=1
set MIOPEN_FIND_MODE=FAST
python wgp.py
```

`MIOPEN_FIND_MODE=FAST` önemli: MIOpen bazı mimarilerde OOM / ekran sürücüsü çökmesine yol açabiliyor (resmi tavsiye).

## Sorun giderme

- **GPU algılanmıyor** → kart TheRock matrisinde mi kontrol edin, Adrenalin sürücüsü güncel mi, index URL doğru mu
- **"Could not find a version..."** → staging kanalda wheel sürümü değişmiş olabilir; `--pre` bayrağını ve matris bağlantısını kontrol edin
- **Performans** → VRAM'i izleyin, batch/çözünürlük düşürün, donanımsa hızlandırmalı uygulamaları (tarayıcı vb.) kapatın
- Bilinen sorunlar: https://github.com/ROCm/TheRock/issues/808 (Windows paketleri henüz yeni, istikrarsız olabilir)
- Matris: https://github.com/ROCm/TheRock/blob/main/SUPPORTED_GPUS.md
