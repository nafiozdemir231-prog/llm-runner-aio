
## 2026-09-26 17:40 — requirements.txt: Open WebUI v0.11.4 zorunlu 4 paket eklendi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| requirements.txt | google-re2==1.1.20251105, aiodns==3.6.1, hiredis==3.4.0, rapidocr==3.9.2 eklendi | Yeni PClerde venv eksigi nedeniyle "No module named re2" hatasi; kalici cozum |

## 2026-09-26 17:54 — surum degistirme araci eklendi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| tasks/bump-version.ps1 + .bat | v1.7->v1.8 toplu degistirici (DryRun destekli) | Elle surum artirma ihtiyacli |

## 2026-09-26 18:02 — araclari sadelestirme
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| tasks/bump-version.ps1, tasks/bump-version.bat | Silindi | Yerine tasks/bump_version.py gecti (tek arac) |

## 2026-09-26 18:03 — bump_version.bat eklendi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| tasks/bump_version.bat | bump_version.py calistiran baslatıcı (python otomatik bulur) | Cift tikla calistirma kolayligi |

## 2026-10-04 09:13 — picoding pi 0.87.1 -> 1.0.2 (yama korumali)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| picoding/package.json + package-lock.json | ^0.87.1 -> ^1.0.2, npm install | Kullanici guncelleme istedi (sadece LLM Runner) |
| electron/main.js (picoding-update) | 3.5 adim: npm install sonrasi apply-compaction-patch.js otomatik calisir | Update butonu yamayi siliyordu; artik korunuyor |

## update — picoding pi extension/paket guncellemeleri
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| picoding/.pi/settings.json | packages: pi-mcp-adapter (5.0.0), npm:@sting8k/pi-vcc@0.8.1 | pi
## --extensions + vcc icin explicit install; fast-uri acigi audit fix ile kapandi (0 vuln) |\n| picoding/.pi/npm/* | adapter 2.32.1->5.0.0, vcc 0.8.0->0.8.1 (gitignored) | Kullanici istegi |\n — picoding pi extension/paket guncellemeleri
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| picoding/.pi/settings.json | packages: pi-mcp-adapter (5.0.0), npm:@sting8k/pi-vcc@0.8.1 | pi
## 2026-10-04 09:24 — picoding pi extension/paket guncellemeleri
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| picoding/.pi/settings.json | packages: pi-mcp-adapter (5.0.0), npm:@sting8k/pi-vcc@0.8.1 | pi
## 2026-10-04 09:45 — Wan2GP b8b18f81 guncellemesi + 10 preset yenilenmesi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| Wan2GP/ | git pull 362c3467 -> b8b18f81 (88 commit) | Kullanici istegi (senaryo C) |
| wan2gp-presets/*/*/requirements.txt (10) | Taban b8b18f81 ile byte-birebir senkron (mmgp 3.8.2, comfy-kitchen 0.2.35, orjson, hf_xet, pydantic 2.11.10, mcp 1.30.0, mir_eval/pretty_midi/mido/symusic); kernel bolumu guncellendi (GGUF 1.0.25 + --no-deps notu, Triton surum eslesmeleri) | Presetler bayatladi |
| wan2gp-presets/nvidia/rtx30xx/* | Sage1+triton<3.3 -> Sage2+triton>=3.6; gecis icin pip uninstall uyarisi | Upstream dokman degisti |
| wan2gp-presets/amd/* (4 aile) | Python 3.12 + torch[device-gfx]==2.13.0+rocm10.0.0 stable index; eski nightly/rocm65 ortamlarini degistirme uyarisi; vcvars adimleri kaldirildi | ROCm/TheRock rehberi yenilendi |
| wan2gp-presets/*/KURULUM.md (10) | INT8 Math Kernels (Comfy Kitchen, R580+ surucu) bolumu eklendi; GGUF 1.0.25 aciklamalari; AMD attention modlari guncel |

## 2026-10-04 19:58 — Strata coklu-model katmani (port 1235 gateway)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| Strata/local/gateway.py | Yeni: tek port model routinq, imza-bazli tek motor paylasimi, swap(/unload+503), idle-unload 600s pasif, SSE passthrough, Windows job object, --check | Kullanici spec 7 |
| Strata/local/checkargs.py | Yeni: bayrak/uyumluluk denetimi + --fix-args (kalibrasyon esitleme, yedekli) | Spec #5 dogrulama |
| Strata/local/models.json | Aynen kullanici icerigi (host 0.0.0.0 port 1235 base 1236 idle 600) | Spec 2 |
| Strata/MULTI-MODEL.bat, GUNCELLE.bat | Yeni; SAF ASCII+CRLF; GUNCELLE upstream UPDATE.bat yerine git pull + setup.py --update | Spec kural 6 |
| strata-layer/ | Dis repoda izlenen ana kopyalar (5 dosya) | Nested repo disinda izlenebilirlik |
| .gitignore | /Strata/, /models/strata/ eklendi | Dis repo + runtime gürültüsü |

## 2026-10-04 20:19 — Strata Electron entegrasyonu (Sunucular + System Detection)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/strata.js | YENI modul: status/setup/calibrate/config/start-stop/update handlerlari; startGateway/stopGateway jenerik girisleri; yedekli config yazimi (kural 7) | Spec madde 2-6 |
| electron/main.js | require + serverStates.strata(1235) + serverNames + startServer/stopServer strata dalı + strata.register | Start All/Stop All uyumu |
| electron/preload.js | strata API (9 metod) + strata-setup-log kanali | Renderer erisimi |
| src/index.html | Sunucular: Strata karti (start/stop/open/calibrate/update/config paneli/log); System Detection: RAM>=48GB model indirme secimi | Spec madde 2,3,5,6 |
| src/renderer.js | refreshStrataStatus/runStrataSetup/Calibrate/Update/saveStrataConfig + sunucu tablo kaydi | UI akisi |
| strata-layer/gateway.py | / bilgi sayfasi eklendi (Open in Browser) | Smoke test |

## 2026-10-04 20:35 — Strata -> Open WebUI otomatik baglanti (1235)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/strata.js | strata-connect-openwebui handler: openwebui.db config tablosuna openai.api_base_urls += http://127.0.0.1:1235/v1 (idempotent, ON CONFLICT upsert) | DB tabanli = guncellemeler silmez |
| electron/preload.js + src/index.html + src/renderer.js | 🔗 Open WebUIye Ekle butonu + connectStrataToOwui akisi | Kullanici istegi |
| openwebui/openwebui.db | 1235 baglantisi eklendi (test amacli gercek yazim) | Istek dogrulamasi |

## 2026-10-04 22:25 — Strata backend testleri + STRATA_DEV anahtari
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/strata.js | eligible += (process.env.STRATA_DEV === "1") | 32GB test makinesinde karti gorunur kilmak icin (varsayilan degismez) |
| Strata/.tmp-test/*.json + unit_test.py | mock ark test fixturleri + injection unit probe | Backend testleri (repoya girmiyor, Strata/ ignore) |

## 2026-10-06 21:55 — Strata: auto-start + vision secenegi + i18n + calibrate --yes
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/strata.js | calibrate call += --yes; setup --vision gpu/cpu/no; status += vision alani | Menutakilmasininotomatik cozumu; vision config sectigi |
| src/renderer.js | auto_start_strata (varsayili acik) + configured guardu; vision dropdown -> setup opts; dinamik metinler Ingilizce | Windows baslangicta Strata; i18n tutarliligi |
| src/index.html | cb-auto-strata; strata-vision select; Strata karti+install bolumu data-i18n | Kullanici istekleri |
| src/lang/*.json (8 dil) | 15 yeni strata anahtari (en/tr/de/es/fr/pt/zh/ja) | Cok dilli arayuz |

## 2026-10-06 22:08 — Strata: config paneline vision + install bolumu kalici gorunurluk
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/index.html | Sunucular karti config paneline strata-config-vision select; 256K etiketi Ingilizce | Kullanici: config kisminda vision yoktu |
| src/renderer.js | install bolumu configured=true da gorunur; model select kurulu boyluta on-secim; iki vision dropdown senkron; saveStrataConfig vision degisikliginde setup yeniden (stop+re-setup); switchTab servers/system -> refreshStrataStatus | Kullanici: model indirme secenegi gorunmuyordu + tazelik |
| electron/strata.js | status += modelSize (--pack basename -> IQ3_XXS) | Vision re-setup boyut eslestirmesi |

## 2026-10-06 22:25 — Strata: kalibrasyon geribildirimi + API key alani + update ayar koruma
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| strata-layer/gateway.py (+Strata/local) | _auth_ok += ?api_key= query destegi (test: keysiz 401, query 200) | Open in Browser bos key hatasi vermesin |
| electron/strata.js | calibrate heartbeat (45sn); configWrite apiKey alani (bos=PC temizle/LAN uret); status += apiKey; update oncesi models.json+kapı config yedek, eksikse geri yukle | Madde 1,3,4 |
| src/renderer.js | butonlarda kalibrasyon/guncelleme/kurulum sirasinda kum saati; apikey input doldurma/one-secim; Open in Browser URL += api_key; config kaydetme sonrasi kalibrasyon hatirlatmasi | Madde 1,2,3 |
| src/index.html | API key input + kalibrasyon ipucu help-text (data-i18n) | Madde 2,3 |
| src/lang/*.json | label_api_key + strata_calibrate_hint (8 dil) | i18n |

## 2026-10-06 22:45 — Strata upstream guncellemesi + rebase dayanikli update
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| Strata/ (repo) | 6f32ec0 -> 82f46a8 (origin/main, rebase nedeniyle reset --hard; untracked katman korundu) | Son surume gecis |
| electron/strata.js | update: fetch + merge-base kontrol -> ff-only veya reset --hard | Hedef PCde ayni divergans yasayacakti |
| Strata/GUNCELLE.bat + strata-layer/GUNCELLE.bat | config yedekleme + fetch/rebase-aware update | Manuel guncelleme de guvenli olsun |

## 2026-10-06 23:12 — README guncellemesi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| README.txt + README.md | Strata servisi eklendi: gereksinim (48GB RAM/12GB VRAM), servis anlatimi (port 1235, cift model tek motor, kalibrasyon, idle unload, LAN+API key, vision, update) + Key Features maddesi; dogru upstream link Niko1221/Strata | Kullanici istegi |

## 2026-10-08 20:36 — Strata v0.1.41 guncellemesi + paralel istek secenegi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| Strata/ (repo) | 82f46a8 -> fb58e0d ff-only pull; ayar yedegi .tmp/backups/manual-* | upstream v0.1.41: parallel/batch-groups/backlog, CUDA/AMD fixleri |
| electron/strata.js | status/config-read parallel alani; config-write iki kapida da "parallel" anahtari (1-8); setup --parallel N iletisimi; syncCoderArgs parallel eszitleme | #465 opt-in paralel istek tek motor kuralini bozmadan |
| src/index.html + renderer.js | Config paneline Parallel requests dropdown (1=off,2-8); degisiklikte gateway otomatik restart; state senkron | kullanici talebi: server config kismina paralel secenek |
| src/lang/*.json (8) | label_parallel + opt_parallel_off | i18n |

## 2026-10-09 19:24 — OW API key tazeleme
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/strata.js | connect-openwebui: url zaten varsa keys[i] karsilastirilip guncellenir (status updated); bos key kayitliyseda eklenir | Hedef PC logu: config kaydinda LAN key yeniden uretildi; OW eski keyle 401 alacakti |

## 2026-10-09 20:48 — Kalibrasyon sonucunun ezilmesi (hedef PC raporu #5)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/strata.js | mergeGateConfigs + pickCalibratedSource eklendi; syncCoderArgs(backupDir, afterCalibration) kalibre bayraklarin tam kumesine sahip configi kaynak secer ve IKI dosyaya da yazar; ayni icerikli dosyaya yazmaz (mtime stabil); calibrate handler true ile cagrir; handler-daki duplicate "Tamamlandi" logu kaldirildi | setup.py --calibrate mtime'i en yeni configi (coder) kalibre ediyordu; eski sync genel(untuned)->coder kopyasi tuningi siliyordu (--pool-workers 15 kalmisti). Test: .tmp/test_sync_calibrate.js 19/19 |

## 2026-10-10 — Kullanici istekleri 1-4 (Strata UI/extension)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/renderer.js, src/index.html | Model boyutu secenekleri artik pasiflestirilmiyor (RAM onerisi etikete eklendi: "(~64 GB RAM)"); Strata "Open in Browser" butonu + updateBrowserButton cagrisi kaldirildi (browserId:null) | Kullanici: Strata zaten calismayaci eliyor; browser butonu istenmiyor |
| electron/strata.js | API key otomatik uretimi tamamen kaldirildi (setup + configWrite); bos alan bos kalir; crypto require silindi; ensureLayer artık icerik farkliysa katmani tazeler (eski kurulumlara gateway guncellemesi ulasir) | Kullanici: key zorunlu olmasin; hedef PC'de eski local/gateway.py kalsin istemedik |
| strata-layer/checkargs.py, gateway.py | Kural 9 HARD -> WARN/NOTE (LAN + bos key = kimlik dogrulamasiz erisim uyarisi); gateway bind reddi kaldirildi | Bos key ile calisma destegi |
| picoding/.pi/extensions/auto-model-discovery.ts | "strata" provider'i eklendi (:1235/v1, port+key models.json'dan, bos key destekli); local-openai korundu; Vane araci EKLENMEDİ (kullanici geri istedi) | pi icinden Strata modellerine erisim |

## 2026-10-09 22:01 — Strata hiz satirlari app logunda gorunmuyor
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| strata-layer/gateway.py | Ark.start: serve alt surecine STRATA_REQUEST_LINES=1 env (istek basi "prefill X tok/s decode Y tok/s" satiri stdout'a dusurur) + tail_speed_lines kuyruk isparancisi: logs/gateway-arkN.log'daki tok/s ve GiB/s icerikli satirlari "[gateway] arkN> ..." olarak app'e basar; truncate/rotasyon dayanikli | Hiz verileri sadece ark log dosyasindaydi, UI'a hic ulasmiyordu. Test: .tmp/test_tail.py (filtre + rotasyon) OK |

## 2026-10-10 18:44 — Vision parse hatasi tekrarlayan setup tetikliyordu (hedef PC logu)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/strata.js | Status'ta vision artik config'in "vision" bolumunden okunuyor ({gpu:bool} -> gpu/cpu; yoksa bayrak kontrolu 'no'); args[v+1] parsing kaldirildi | Upstream args'ta --vision bayragindan sonra --vram-reserve-mib geliyordu; curVision="--vram-reserve-mib" oldugu icin HER Save vision degisikligi sanip tam setup tetikliyor, ust uste "Setup already in progress" hatasi ve 3x setup cosu uretiyordu |
| src/renderer.js | Vision tetikleme oncesi setupRunning kontrolusu (skip + bilgi satiri); setup basarisinda state.servers.strata.vision hemen guncellenir | Ayni degisikligin art arda Save'lerle tekrar tetiklenmesini kesmek icin |

## 2026-10-10 22:55 — Setup tuning sifirlamasina Gorsel uyari
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/strata.js | strata-setup handler'i: yeni args uretilmeden once eski general config'deki CALIB_FLAGS izleri yakalanir; yenide yoksa "[SETUP] UYARI: ... Calibrate tekrar calistirilmali" loglanir | Hedef PC: vision no->gpu setup'i upstream'in kayitli kalibrasyonunu geri yuklemedi (hardware_key vision/context iceriyor); 88.1 tok/s tuning sessizce defaults'a dondu |

## 2026-10-10 23:15 — Hiz satirlari canlida dogrulandi; filtre sikilastirildi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| strata-layer/gateway.py | SPEED_LINE_RE = done:/request prompt/GiB/s (eskisinde tok/s generic -> thinking/answering canli ilerleme satirlari saniyede bir UI'a akiyordu) | Hedef PC log dogrulamasi: ozet satirlari geldi ama 17 gürültü satiri; test .tmp/test_tail2.py OK |

## 2026-10-10 23:35 — Open WebUI 0.11.4 -> 0.12.0
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| openwebui/ | git pull --ff-only (586 commit), pip -r backend/requirements.txt, npm install + npm run build (12 GB heap ile) | Kullanici istegi: OW guncellemesi; 8 GB heap V8 OOM verdi -> 12 GB ile build basarili |
| electron/main.js | server-update: openwebui icin pip backend gereksinim senkronu adimi eklendi; NODE_OPTIONS heap 8192 -> 12288 | Uygulamanin Update butonu backend pip adimini calistirmiyordu; build bellek yetmezligi cokme riskindeydi |

## 2026-10-11 00:40 — UI goc Faz 1: sidebar iskeleti
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/index.html | toolbar-center icindeki #tab-bar kaldirildi; #main-container ilk satirina #sidebar aside eklendi (ayni .tab-btn + data-tab + data-i18n yuzeyi, sidebar-foot ile) | Mock04'e kademeli gecis — renderer.js switchTab ayni secicilerle calismaya devam eder |
| src/css/style.css | Faz 1 CSS: main-container row; #sidebar (var tabanli, light tema uyumlu), .side-btn aktif/hover, dar pencerede ikon sidebar (860px) | Mevcut degisken/tema mimarisini bozmadan yeni yerlesim |

## 2026-10-11 01:10 — UI goc Faz 2: Sunucular launcher + alt menuyu
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/index.html | tab-servers icine #srv-launcher (buyuk Start/Stop All + Baslangic Secenekleri karti + apply-startup) eklendi; #server-panel baslangicta hidden; 6 server-section'a data-srv; sidebar'a #srv-subnav (back+6 sunucu); global-actions kaldirildi (btn'ler launchera tasiindi, id'ler ayni); settings modalinden Startup/Individual gruplari cikarildi (launchera tasindi — cb id'leri tek kopya) | Mock04 akisi: Sunucular=aclipayda launcher; sunucular alt menuden tek tek acilir |
| src/renderer.js | switchTab sonuna serversViewReset hook'u; dosya sonuna setupServerSubnav IIFE (showLauncher/showServerOnly/back + apply-startup -> saveAllSettings) | Mevcut id/baglanti mantigina dokanmadan yeni gorunum kontrolu |
| src/css/style.css | Faz 2 CSS: launcher, big-btn, startup-card, srv-subnav/srv-nav-btn, server-panel.hidden, light tema hover | Görsel bütünlük |

## 2026-10-11 01:40 — UI goc Faz 3+4: Ayarlar secmesi + kart cilasi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/index.html | toolbar settings-btn kaldirildi; sidebar'a data-tab="settings" butonu; yeni #tab-settings (tema/font/dil + Apply); modal govdesi bos kabuga donustu (closeModal baglantisi korunur) | Faz 3: Ayarlar artik gercek bir sidebar gorunumu |
| src/renderer.js | switchTab'a settings hook: secmeye giriste populateSettingsForm() | Form hep guncel config ile dolar |
| src/css/style.css | Faz 4: fieldset kartlari (radius/golge/legend pil), servis kartlarina durum bazli sol bant (:has running/error), status pill, server-config/log-toggle cilasi, launcher startup karti | Mock04 estetikine tam gecis — id/yapi degismeden salt CSS |

## 2026-10-11 02:05 — UI goc Faz 5: mock04 temasi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/css/style.css | :root koyu palet mock04'e cevrildi (#101317/161b22/0b0d10, yesil 4ade80, mavi 3f6ad8); toolbar/sidebar/buton kimlikleri (start yesil #14532d, stop/danger #7f1d1d, secondary #1d2430), launcher butonlari gradyan, config #0f1318, log kutusu monospace #0c0f13, status pill renkleri | Kullanici tespiti: uygulama mock04'e benziyordu ama ayni degildi — tema farki kapandi; light tema [data-theme] kendi degiskenlerinde |

## 2026-10-11 02:40 — UI goc Faz 6: sunucu kartlari mock04 DOM'u
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/index.html | 6 sunucu bolumunde fieldset/legend -> div.mcard + h4 (sag ustte status pill); "Status:" satiri ve btn-hide-*-config / log-toggle butonlari kaldirildi; config ve log artik <details class=cfgbox/logbox> icinde (id'ler aynen: *-config, *-log, strata-server-fieldset div'e tasiindi) | Kullanicinin "aynisi degil" tespiti — kart iskeleti mock04 ile ayni DOM oldu |
| src/renderer.js | setupDetailsSummaryLabels IIFE: details acilirken summary etiketi 'Gizle/Goster' cevirir; eski toggle fonksiyonlari etkisiz (korunur, guarded) | Mock04 davranisi |
| src/css/style.css | mcard kart stilleri, srv-status-pill, cfgbox/logbox kutulari, :has ile durum bandi | mock04 gorunumu |

## 2026-10-11 03:15 — pi vision hatasi duzeltmesi (kullanicinin verdigi yol: C:\Users\Nafi\.pi\agent\extensions)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| C:/Users/Nafi/.pi/agent/extensions/auto-model-discovery.ts | extractVision() eklendi (status.args --vision/--mmproj veya meta.vision); model kayitlarinda input artik gorsel destekliyse ["text","image"]; log'a ", vision" etiketi | Pi, modelleri sabit text-only beyan ediyordu; gateway vision=gpu oldugu halde goruntu istekten cikariliyordu |
| picoding/.pi/extensions/auto-model-discovery.ts | Ayni vision tespiti + meta.n_ctx context fallback | Proje kopyasi tutarliligi |

## 2026-10-11 04:10 — UI goc Faz 7 (ekran goruntu karsilastirmasi ile)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/index.html | Sidebar sirasi mock04'e cevrildi (aihublocal, Sunucular+altmenu, Modeller, PiCoding, Donanim, Ayarlar); alt menu kisa isimler + led id'leri; sidebar-foot donanim satiri (side-hw-line/sub); launcher butonlari launcher-card icine alindi + launcher-hint i18n; cancel-startup butonu eklendi | panel.png vs calisan-uygulama.png fark tablosu madde 2,3,4,5,7 |
| src/renderer.js | setupSidebarStatusLeds IIFE (MutationObserver ile status-indicator -> led; led-any toplam); updateSidebarFootprint(hw) + detectHardware hook; cancel-startup -> populateSettingsForm | Canli led'ler, donanim bilgisi, geri alma |
| src/css/style.css | srv-led stilleri, launcher-card, startup-card legend baslik stili, checkbox seritleri (tam genislik koyu satirlar), server-checkboxes grid, panel h2 beyaz | Mock04 gorunumu |
| src/lang/*.json (8) | launcher_hint anahtari | Yeni i18n metni |

## 2026-10-11 04:30 — aihublocal hedef URL guncellemesi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/renderer.js | HOME_SITE_URL -> https://www.aihublocal.com/llm-runner-aio (curl 200) | Kullanici istegi; CSP frame-src ayni hostu zaten izinliyor |
| src/index.html | home butonu title metni guncellendi | Tutarlilik |

## 2026-10-12 10:55 — Light tema duzeltmesi (kullatici ihbari)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/css/style.css | Faz5 koyu override `:root` -> `[data-theme="dark"]`; 13 sabit hex kurali tema degiskenine cevrildi (nav-active, fieldset/legend, secondary/tool btn, input, card-deep, summary, mcard h4, hw-line, checkbox seridi); yeni tema degiskenleri tanimlandi; light palet + status/led uyumlari dosyanin EN SONUNA eklendi | Root cause: Faz5 `:root` bloğu `[data-theme="light"]`'tan sonra geldigi icin esit ozgullukle light degiskenleri eziyordu; ustelik sabit koyu hex'ler temadan bagimsizdi |

## 2026-10-12 11:10 — Donanim altbilgisi kalici hale getirildi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/renderer.js | autoDetectAndSaveHardware: cache ve taze tespit dallarina updateSidebarFootprint cagrisi; populateSettingsForm'a config tabanlı fallback (cpu_name/gpu_name/vram_gb/ram_gb -> state.hardware) | Kullatici her acilista "Donanim algilanmadi" goruyordu; altyapi (24s localStorage cache + otomatik tespit) vardi ama sidebar footer beslenmiyordu |

## 2026-10-12 11:30 — Sidebar canli olcerler (GPU/VRAM/Watt/RAM)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/main.js | get-system-stats IPC handler: os.totalmem/freemem + nvidia-smi utilization/memory/power; 1.5sn cache, 2sn timeout | Kullatici GPU/ram kullanimi ve watt istedi |
| electron/preload.js | hardware.stats() expose | Renderer erisimi (contextBridge guvenli) |
| src/renderer.js | pollMeters: 4sn'de bir #side-meters metni; document.hidden'da durur | Canli gosterge, bosuna CPU yakmaz |
| src/index.html | #side-meters div'i sidebar-foot icine | Gosterim alani |
| src/css/style.css | #side-meters stili (monospace) | Okunabilir olcer satiri |

## 2026-10-12 12:05 — UI goc Faz 9: sidebar "Kaynaklar" cubuklari
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/index.html | #side-meters duz metin -> #side-res karti (RAM/VRAM etiket+deger+cubuk, GPU yuk/watt meta satiri) | Kullatici Screenshot_1.png referansi: "su tip yazsa" |
| src/renderer.js | pollMeters genisletildi: cubuk genislikleri % ve `27.4 / 64 GB` bicimli degerler; GPU yuku+watt ayri satir | Referans gorunum |
| src/css/style.css | #side-res karti, .res-bar RAM (indigo->mavi->cyan) / VRAM (sari->turuncu->kirmizi) gradient dolus cubuklari | Mock estetik eslesmesi |

## 2026-10-12 12:20 — Olcer satiri etiketi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/renderer.js | "GPU yükü %" -> "GPU Load %" | Kullatici Ingilizce istedi (commit 93818e2) |

## 2026-10-12 13:00 — UI goc Faz 10: Strata hiz rekorlari + canli pp
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| strata-layer/gateway.py | SPEED_LINE_RE genisletildi: \"reading the prompt\", \"] thinking:/answering:\" satirlari da app'e iletilir | Strata server.py bu satirlari zaten basiyor (UI spam filtresi gevsetildi); upstream kod degismedi |
| src/renderer.js | server-log handler once handleStrataProgress'e sorar (tuketlenen satir loga yazilmaz); setupStrataSpeedStats IIFE: oturum bazli bestTg/bestPp (bellek, her acilista sifir), prompt bar guncelleme, 5000 tok/s ust sinirli saglama | Kullatici istegi: rekorlar + yuzdeli pp; "her oturumda degissin" -> localStorage YOK |
| src/index.html | Strata kartina .strata-stats (st-best-tg / st-best-pp pill'lari); sidebar Kaynaklar kartina Prompt cubugu (bar-pp/res-pp-val) | Gorunum |
| src/css/style.css | stat-pill + res-bar.prompt gradient (mavi->yesil) | Estetik |

## 2026-10-13 11:25 — Faz 10 kanal duzeltmesi (canli log ihbari ile)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/renderer.js | onSetupLog dinleyicisi de handleStrataProgress'e soruyor; tuketlenen satir loga yazilmaz | Root cause: gateway stdout 'server-log' degil 'strata-setup-log' kanalindan akiyor (electron/strata.js startGateway send = safeSend('strata-setup-log')); hook yanlis kanala takilmisti, ilerleme satirlari log alaninda gorunmeye devam ediyordu |

## 2026-10-13 11:40 — UI goc Faz 11: Servers akordeonu + sidebar scroll
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/index.html | Servers butonuna #srv-chev ok isareti | Akordeon durumu gosterimi |
| src/renderer.js | serversViewReset yeniden duzenlendi (expanded/enteringStamp mantigi); Servers tiklama dinleyicisi: yeni giris->acik, ayni sekmede tekrar tiklama->daralt | Kullatici istegi + Screenshot_2.png'de Kaynaklar karti ekran altinda kesiliyordu |
| src/css/style.css | #srv-subnav max-height/opacity gecisli collapsed; .side-chev donme animasyonu; #sidebar overflow-y:auto + scrollbar stili | Ac/kapa animasyonu; kesilme sorununun kalici cozumu |

## 2026-10-13 12:10 — UI goc Faz 12: son menuyi hatirla
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/renderer.js | switchTab her secimde last-tab yazar; alt menu tiklamalari last-srv; akordeon durumu srv-nav-expanded kalici; init sonuna restore blogu (switchTab + serversShowServer); serversShowServer disariya acildi; reset artik expanded'i zorla acmiyor (kayitli durum esas) | Kullatici: "son hangi menude kapattiysak o menude acilsin" |

## 2026-10-13 12:40 — Screenshot_3 ihbarlari (AMD PC) duzeltmeleri
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/renderer.js | srvBtn dinleyicisi capture moduna alindi: switchTab'dan once wasOnServers okunur; disaridan giris->setExpanded(true), ayni sekmede tiklama->toggle (enteringStamp zaman damgasi tuzağı kaldırıldı) | Restart sonrasi iki-tiklama tuzagi ve animasyon sirasinda "eksik menu" algisi |
| src/css/style.css | #srv-subnav max-height 420->720 | Buyuk font ayarinda alt menu ogelerinin kirpilmamasi |
| src/renderer.js | applyLanguage: yerlesik JSON'lardan gelen <br>/<b>/<i> icerigi innerHTML ile uygulanir | Launcher ipucunda "<br>" kelime olarak gorunuyordu (Screenshot_3) |

## 2026-10-13 13:10 — Alt menu kirilmasi kok cozumu (Screenshot_4)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/css/style.css | srv-subnav max-height/transition kaldirildi; collapsed=display:none, acilis opacity/transform keyframe (.expanding) | max-height gecisi kare kisitlamasinda ara yukseklikte donuyordu (4 ogede kirpma) |
| src/renderer.js | setExpanded + serversViewReset .expanding animasyon sinifi ekler/320ms'de kaldirir | Giris/genisleme animasyonu layout'suz |
| electron/main.js | webPreferences.backgroundThrottling:false | Tray/gizli pencerede led-log-animasyon donmesin |

## 2026-10-13 14:00 — run-dev.bat olusturuldu (kisayol ihbari)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| run-dev.bat | Yeni dev baslatici: cd %~dp0, node/npm/electron/dosya kontrolleri, npm run dev (--enable-logging), --check smoke modu | Kisayol muhtemelen var olmayan run-dev.bat'i hedefliyordu; ayrica bilesik yol hatalarina karsi self-test'li |

## 2026-10-13 14:20 — DevTools kisayol duzeltmesi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/main.js | webContents.before-input-event: Ctrl+Shift+I / F12 toggleDevTools; Ctrl+Shift+C detach+inspect | Kullatici "dev tools acilmiyor" - frame:false + setApplicationMenu(null) varsayilan akseleratorleri olduruyordu |

## 2026-10-13 14:40 — Konsol hatasi (Screenshot_6) duzeltmesi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/renderer.js | updateUIText 15b blogu: sabit 5 elemanli serverLabels dizisi + indeks forEach kaldirildi; span[data-i18n] uzerinden anahtar okuma | Konsoldaki TypeError: Cannot read properties of undefined (reading 'key') — Strata checkbox'i 6. olarak eklenince dizi tasidi |

## 2026-10-13 15:00 — Models Config gorunum tasmasi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/css/style.css | .form-row flex-wrap:wrap | Sol kolon genisligi label+select+Load+Open INI'yi almıyor; butonlar fieldset sagindan tasip Download Models kartinin arkasinda kaliyordu (Screenshot_5/6'daki hayalet dikdortgen) |

## 2026-10-13 16:20 — UI goc Faz 13: llama.cpp hiz rekorlari
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/renderer.js | server-log handler'a llamacpp dallanmasi; setupLlamacppSpeedStats IIFE (prompt eval/eval time + pp/tg regex, oturum bazli rekor) | Kullatici pp/tg gosterimi istedi; llama-server canli yüzde basmadigindan rekor pill'i ile karsilandi |
| src/index.html | llamacpp mcard icine .strata-stats (llamacpp-best-tg / llamacpp-best-pp) | Gorunum |

## 2026-10-13 17:05 — Strata upstream guncellemesi (bu makine)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| Strata/ (git pull --ff-only) | 61b3fb5d -> 7695859a; 72 yeni commit (NaN guard #1892, pinned-buffer prefill #1712, STRATA_PCIE_AUTO_CANON + STRATA_ADAPT_OVERLAP Windows opt-in'leri, route-resident swap vb.) | Kullatici "guncelle" istedi; local/ (models.json) ve GUNCELLE/MULTI-MODEL bat'ler untracked -> korundu; sunucu parser uyumu dogrulandi ("reading the prompt"/"request prompt" satirlari mevcut, syntax OK) |
| .gitignore | Strata/ eklendi | Untracked dev upstream clone yanlislikla commetlenmesin |

## 2026-10-13 17:20 — pi coding agent guncellemesi (kullanici onayi ile)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| global npm @earendil-works/pi-coding-agent | 1.0.0 -> 1.1.0 | Kullatici "guncelle" dedi; PP% beklentisi 1.1.0 changelog'unda yok ama OSC 7501 program status (working/blocked/done) eklendi; custom provider/extension API'sinde breaking change yok - picoding model kesfimiz uyumlu |

## 2026-10-13 18:10 — UI goc Faz 14: Provider yonetimi (PiCoding)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| picoding/.pi/extensions/auto-model-discovery.ts | Tam yeniden yazim: sabit TARGETS -> providers.json okuma (aday sirasi env/cwd/~/.pi/agent/repo), apiKey Bearer destegi, URL sadelestirme, FALLBACK_TARGETS geri-donusu; ctx/vision mantigi korundu | Provider ekleme artik kod duzenlemeden veri ile |
| picoding/providers.json | Yeni: 3 varsayilan provider tohumu (185 llama/strata, 177 llama) | Tek dogruluk kaynagi |
| electron/main.js | picoding-get-providers / picoding-save-providers handler'lari + validateProviders + ayna yazi (~/.pi/agent/providers.json, kullanici onayli yol) | UI kalici kayit |
| electron/preload.js | getProviders/saveProviders kopruileri | IPC erisimi |
| src/index.html | PiCoding sekmesine Providers fieldset'i (liste + form + test) | Kullanici istegi |
| src/renderer.js | setupProvidersSection IIFE: listele/ekle/duzenle/sil/aktif/test; local escapeHtml tanimi | UI mantigi |
| src/css/style.css | .provider-list/.provider-row/.tiny/.danger stilleri | Gorunum |
| sync_pi_config.py | sync_providers_json adimi (picoding/providers.json -> ~/.pi/agent/) + main cagrisi | Kurulum senkronu |
Not: extension canli duman testi gecti (strata-185 2 model ctx=262144 vision; llama-cpp-177 14 model; 185 llama kapali -> zarif atlama). ~/.pi kopyalari sync_pi_config.py ile tazelendi.

## 2026-10-13 18:40 — Faz 14 makyaj: Instructions siralamasi + Providers dili
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| src/index.html | Providers fieldset'i Instructions ALTINA tasindi; instructions-content 'hidden' sinifi kaldirildi (varsayilan acik), toggle butonu 'Hide Instructions' ile baslar | Kullanici: "Instructions cok asagida ve varsayilan acik baslamali" |
| src/index.html | Providers statik metinleri Ingilizce + 8 data-i18n anahtari (providers_legend/help, provider_id/url/key_label, btn_provider_add/test/cancel) | Kullanici: "dil türkçe sadece sanırım" -> uygulama EN tercihli; eksik anahtar mevcut davranista guvenli (updateUIText atlar) |
| src/lang/en.json, tr.json | 8 yeni anahtar (EN+TR degerler hide_instructions_btn sonrasina) | Cift dil destegi |
| src/renderer.js | setupProvidersSection dinamik metinleri EN'ye cevrildi | Tutarlilik |
| electron/main.js | validateProviders hata mesajlari EN | UI'da gorunen metinler |

## 2026-10-13 19:00 — Modern kaydirma cubuklari
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/main.js | whenReady oncesi app.commandLine.appendSwitch('enable-features','OverlayScrollbar,OverlayScrollbarFlashWhenMouseEnter') | aihublocal <iframe> cross-origin -> CSS enjekte edilemez; Chromium bayragi iframe icindeki klasik kalin barlari da modern overlay yapar |
| src/css/style.css | Global ::-webkit-scrollbar yenilendi: transparent track, rgba incecik yuvarlak thumb (border+background-clip), hover/active tonlari, scrollbar-button (kare oklar) ve corner kaldirildi | Kullanici "saga/sola + asagi/yukari kaydirma kotu gorunuyor" dedi |

## 2026-10-13 20:15 — Open WebUI MFA eksik bagimliliklari (diger PC hatasi)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| requirements.txt | pyotp==2.9.0 + qrcode==8.2 eklendi | OW guncellemesi yeni MFA router'i getiriyor: open_webui/utils/mfa.py `import pyotp` -> ModuleNotFoundError, port 3000 acilmiyor (exit 1). OW requirements.txt karsilastirmasinda 5 eksik bulundu; orjson/regex/langchain-core zaten transitive karsilaniyor, ikisi gercek eksikti |

## 2026-10-13 20:40 — HAT-41: Update butonu untracked merge engeli (diger PC)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/main.js | Yeni helper quarantineUntrackedOverwriteBlockers(dir,log): git fetch -> HEAD..FETCH_HEAD gelen dosyalar ile calisma agacindaki untracked dosyalarin kesisimini bulur, .tmp/untracked_backup_<ts>/ altina tasir. picoding-update ve genel server-update (openwebui/strata/vane) pull oncesi cagrir | OW Update'i "untracked working tree files would be overwritten by merge" ile abort etti; ayrica eski tracked config.py + yeni untracked audio dosyalari karsimida ImportError DEFAULT_REALTIME_TTS_PROMPT_TEMPLATE olustu |

## 2026-10-13 21:05 — HAT-41 devamı: scope hatası düzeltmesi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| electron/main.js | quarantineUntrackedOverwriteBlockers setupIPC govdesinden alınıp modül seviyesine (startServer öncesi, satır ~2262) tasindi | server-update handler modül seviyesinde; ic fonksiyonu göremedi → "quarantineUntrackedOverwriteBlockers is not defined". Test: .tmp scratch origin+work reposu, untracked b.txt karantinaya tasinip pull PASS (b.txt = NEW-UPSTREAM) |

## 2026-10-12 — Strata /v1/models context bildirimi (HAT-42)
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| strata-layer/gateway.py | ctx_from_cfg(cfg) helper (+--max-context/--ctx-size ayiklama) + do_GET models blogunda entry.meta.n_ctx / context_length setdefault | Ark lazy-start oldugundan pi acilisinda backend meta gelmiyor, auto-model-discovery varsayilan 128000'i kullanıyordu; artik config'den gercek ctx (orn. 131072) bildiriliyor; canli backend meta'si one cikar |

## 2026-10-12 — OW veritabanı kurtarma güvenliği (HAT-43)
| Dosya | Değişiklik | Neden |
|------|--------|--------|
| electron/main.js | rescueOpenwebuiDatabase() eklendi (quarantineUntrackedOverwriteBlockers yaninda, modul seviyesi); startServer openwebui dalinda WEBUI_SECRET_KEY bloğundan önce çağrılıyor; restoreDatabase temizliği en son .bak'i silmeyecek şekilde değiştirildi | Yarım kalan Update DB'yi .temp_backup'a taşıyıp geri koymamıştı; OW boş yeni DB ile açıldı (onboarding). Artık açılışta otomatik yakalanır; sqlite yoksa boyut sezgisi; hiçbir aktif DB silinmez, 'openwebui.replaced-<ts>.db' olarak saklanır |

## 2026-10-12 — Ahmet'in pi extension kopyasi + vision genisletmesi
| Dosya | Degisiklik | Neden |
|------|--------|--------|
| tasks/ahmet/auto-model-discovery.ts | Tamamen yenilendi: providers.json veri kaynagi, OPENWEBUI_BASE_URL/API_KEY env geri donusu (sabit key kaldirildi), extractVision/extractContextWindow, coklu provider | Eski kopyada vision yoktu (input:["text"] sabit) ve ctx hep 128000; ayrica dosyada sabit API key duruyordu |
| tasks/ahmet/providers.json.ornek | Yeni | Ahmet icin kurulum tarifleri (ngrok'un gateway'e noktalama onerisi) |
| picoding/.pi/extensions/auto-model-discovery.ts | extractVision += architecture.input_modalities kontrolu; RawModel interface'e architecture eklendi | Strata sunucusu modaliteleri bu alanda da yayinliyor; uclu tespit daha dayanikli |

## 2026-10-13 — Wan2GP presetleri upstream v18 ile senkronlendi
| File | Change | Reason |
|------|--------|--------|
| wan2gp-presets/*/*/requirements.txt (10 dosya) | `mmgp==3.8.2` pini kaldirildi -> `optimum-quanto==0.2.7 + safetensors + psutil + filelock` (mmgp artik repo klasoru olarak bundled); `phonemizer-fork` ve `espeakng-loader` silindi; sona `xatlas / fast-simplification / scikit-image / resvg-py` eklendi; kaynak commit referansi b8b18f81 -> 57d57dc7 (v18) | Upstream 04.10 sonrasi degisti: mmgp bundle, ses paketleri cikarildi, 3D mesh + SVG rasterizer paketleri geldi. Setup adim 5b zaten repo requirements ile senkronluyor; presetler de kendi kendine yeter hale getirildi. Wan2GP klonu origin/main ile 0/0 (guncel). |

## 2026-10-13 — Strata upstream guncellemesi (ayar korumali)
| File | Change | Reason |
|------|--------|--------|
| Strata/ (nested repo, repodan bagimsiz) | git pull --ff-only ile v0.1.44.1'e ilerletildi (315 commit, temiz FF; izlenen degisiklik yoktu) | Kullanici talebi: Strata guncellemesi, uygulama ayarlari ayni kalacak |
| Strata/.tmp/backups/manual-<stamp>/models.json | pull oncesi yedek | strata-update akisinin ayar-koruma kurali |
| Strata/ff-only | silindi (19 bayt cop dosyasi) | Eski test artikı |
| strata-layer -> Strata katman kopyalari | ensureLayer eslenimi: bes dosya da BYTE-BYTE AYNI cikti, dokunulmadi; gateway.py'de ctx_from_cfg (HAT-42 fixi) yerinde | Ayarlar ve bizim katman korunuyor |

Not: Bu makinede Strata/.venv yok -> setup.py --update atlandi; hedef PC'lerde uygulama Update butonu engine'i de kendisi yeniliyor.
