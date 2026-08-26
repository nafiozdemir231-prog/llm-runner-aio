# Task: OpenWebUI/SearXNG otomatik git bootstrap + Wan2GP bağımlılık senkronu (repoya göre)

## Steps
- [x] 1. `electron/git-bootstrap.js` saf modülü oluştur (async, execFile tabanlı) + scratch-repo unit testi
- [x] 2. `main.js` server-update: .gitsiz klasörde openwebui/searxng için bootstrap; DB korumasını erken taşı; Vane manuel kalır
- [x] 3. `main.js` wan2gp-setup: preset pip sonrası deponun kendi requirements.txt'inden ikinci pip adımı
- [x] 4. `main.js` wan2gp-update: pull sonrası `pip install -r Wan2GP/requirements.txt` senkronu
- [x] 5. Doğrulama: node --check ×N, CRLF saflığı, bootstrap unit test PASS
- [ ] 6. Dokümantasyon: change.md, README (Wan2GP bölümü), state/todo senkron, commit

## Diagram
```
[GUI Update butonu] ──► server-update IPC
                            │
                     .git var mı?
                      /         \
                   EVET          HAYIR
                    │             │
              stash+pull     SERVER_GIT_REMOTES[type]?
              (mevcut akış)  /            \
                           EVET            HAYIR (vane)
                            │               │
                     git-bootstrap.js   manuel talimatlar
                     init→fetch→checkout (değişmez)
                     → success (hash)
```

## Notes
- Karar (kullanıcı: "sen karar ver, repoya göre"): bağımlılıklarda otorite = klonlanmış deponun kendi requirements.txt'i
- Vane auto-bootstrap'a DAHİL DEĞİL (yerel değişiklikler var, checkout -f silerdi)
- Veri dosyaları (openwebui.db, vector_db/, uploads/) upstream ağacında yok → checkout -f onlara dokunmaz; db ayrıca yedeklenir
