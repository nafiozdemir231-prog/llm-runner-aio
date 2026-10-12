"""
title: Web Search & Reader (SearXNG + Scrapling)
author: Nafi
description: SearXNG tabanli web arama + sayfa okuma araci. Katmanli fetch (curl_cffi -> stealth browser -> trafilatura -> BeautifulSoup), TTL cache, SSRF korumasi, paralel coklu sayfa okuma, GitHub dosya/arama destegi ve Open WebUI citation/status eventleri.
git_url: https://github.com/nafi/openwebuitool
required_open_webui_version: 0.6.0
requirements: requests, beautifulsoup4, trafilatura>=2.0, scrapling>=0.4, pydantic
version: 2.0.0
licence: MIT
"""

from __future__ import annotations

import asyncio
import base64
import ipaddress
import json
import os
import re
import socket
import time
import weakref
from datetime import datetime, timezone
from typing import Any, Optional
from urllib.parse import parse_qsl, parse_qs, unquote, urlencode, urljoin, urlparse, urlunparse

import requests
from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Opsiyonel bagimliliklar: biri eksik olsa bile arac calismaya devam eder.
# ---------------------------------------------------------------------------
try:
    import trafilatura
except Exception:  # pragma: no cover
    trafilatura = None

try:
    from bs4 import BeautifulSoup
except Exception:  # pragma: no cover
    BeautifulSoup = None

try:
    from scrapling.fetchers import Fetcher as _StaticFetcher
except Exception:  # pragma: no cover
    _StaticFetcher = None

try:
    from scrapling.fetchers import StealthyFetcher as _StealthFetcher
except Exception:  # pragma: no cover
    _StealthFetcher = None


# ---------------------------------------------------------------------------
# Modul bazli durum (Open WebUI modulu bellekte tutar -> cache istekler arasi yasar)
# ---------------------------------------------------------------------------
# SearXNG adresi varsayilani localhost (env SEARXNG_URL ile asilir; Docker'da host.docker.internal veya LAN IP)
_DEFAULT_SEARXNG = os.environ.get("SEARXNG_URL", "http://localhost:8080")

_PAGE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_SEARCH_CACHE: dict[str, tuple[float, list[dict[str, Any]]]] = {}
_CACHE_MAX_ENTRIES = 150
# Browser katmani event loop bazinda kilitlenir (asyncio.Lock loop degistirince bozulur)
_STEALTH_LOCKS: "weakref.WeakKeyDictionary" = weakref.WeakKeyDictionary()


def _stealth_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _STEALTH_LOCKS.get(loop)
    if lock is None:
        lock = asyncio.Lock()
        _STEALTH_LOCKS[loop] = lock
    return lock

_TRACKING_PARAM_RE = re.compile(
    r"^(utm_|ga_|_hsenc|_hsmc|mc_cid|mc_eid|fbclid|gclid|msclkid|igshid|spm$|ref$|source$|src$)",
    re.IGNORECASE,
)

_BLOCK_PATTERNS = (
    "just a moment",
    "checking your browser",
    "enable javascript",
    "attention required",
    "verify you are human",
    "cf-chl",
    "challenge-platform",
    "captcha",
    "access denied",
    "403 forbidden",
)

_UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
)


def _log(enabled: bool, message: str) -> None:
    if enabled:
        print(f"[websearchtool] {message}", flush=True)


def _normalize_url(url: str) -> str:
    """Cache anahtari icin izleme parametrelerini ve fragment'i temizler."""
    url = (url or "").strip()
    if not url:
        return ""
    try:
        p = urlparse(url)
        query = [
            (k, v)
            for k, v in parse_qsl(p.query, keep_blank_values=True)
            if not _TRACKING_PARAM_RE.match(k)
        ]
        path = p.path or "/"
        return urlunparse((p.scheme.lower(), p.netloc.lower(), path, "", urlencode(query), ""))
    except Exception:
        return url


def _domain_of(url: str) -> str:
    try:
        host = urlparse(url).netloc.lower()
        return host[4:] if host.startswith("www.") else host
    except Exception:
        return ""


def _unwrap_redirect(url: str) -> str:
    """Arama motorlarinin izleme yonlendirmelerini asil hedefe cevirir (bing/ck/a, ddg /l/, google /url)."""
    url = (url or "").strip()
    if not url:
        return ""
    try:
        parsed = urlparse(url)
    except Exception:
        return url
    host = _domain_of(url)
    query = parse_qs(parsed.query)

    if host.endswith("google.com") and parsed.path in ("/url", "/link"):
        target = (query.get("url") or query.get("q") or [""])[0]
        if target.startswith("http"):
            return target

    if "duckduckgo" in host and parsed.path.startswith("/l/"):
        target = unquote((query.get("uddg") or [""])[0])
        if target.startswith("http"):
            return target

    if host.endswith("bing.com") and "/ck/a" in parsed.path:
        raw = (query.get("u") or [""])[0]
        if raw.startswith("a1"):
            raw = raw[2:]
            try:
                decoded = base64.urlsafe_b64decode(raw + "=" * (-len(raw) % 4)).decode("utf-8", "ignore")
                if decoded.startswith("http"):
                    return decoded
            except Exception:
                pass
    return url


def _truncate(text: str, limit: int) -> str:
    """Siniri mumkun oldugunca cumle sonunda keser."""
    text = (text or "").strip()
    if limit <= 0 or len(text) <= limit:
        return text
    cut = text[:limit]
    for sep in (". ", "! ", "? ", "\n"):
        pos = cut.rfind(sep)
        if pos > limit * 0.6:
            cut = cut[: pos + 1]
            break
    return cut.rstrip() + " ...[devami kesildi]"


def _tidy_text(text: str) -> str:
    """Fazla bosluklari ve tekrarlayan satirlari temizler."""
    if not text:
        return ""
    lines = [re.sub(r"[ \t]+", " ", ln).strip() for ln in text.splitlines()]
    out: list[str] = []
    for ln in lines:
        if not ln:
            if out and out[-1] != "":
                out.append("")
            continue
        if out and out[-1] == ln:  # mukerrer satir
            continue
        out.append(ln)
    cleaned = "\n".join(out)
    return re.sub(r"\n{3,}", "\n\n", cleaned).strip()


def _looks_blocked(html: str) -> bool:
    if not html:
        return True
    probe = html[:6000].lower()
    return any(p in probe for p in _BLOCK_PATTERNS)


def _cache_get(store: dict, key: str, ttl_seconds: int) -> Optional[Any]:
    item = store.get(key)
    if not item:
        return None
    stored_at, value = item
    if ttl_seconds > 0 and (time.time() - stored_at) > ttl_seconds:
        store.pop(key, None)
        return None
    return value


def _cache_put(store: dict, key: str, value: Any) -> None:
    if len(store) >= _CACHE_MAX_ENTRIES:
        oldest = sorted(store.items(), key=lambda kv: kv[1][0])[: max(1, len(store) // 3)]
        for k, _ in oldest:
            store.pop(k, None)
    store[key] = (time.time(), value)


class Tools:
    """SearXNG tabanli web arama ve sayfa okuma araclari."""

    def __init__(self):
        # Open WebUI kayitli valve'lari ancak bu nitelik varsa instance'a yukler.
        self.valves = self.Valves()

    # ------------------------------------------------------------------
    # Ayarlar (Admin Panel > Tools > Valves)
    # ------------------------------------------------------------------
    class Valves(BaseModel):
        searxng_url: str = Field(
            default=_DEFAULT_SEARXNG,
            description="SearXNG instance adresi (varsayilan http://localhost:8080). JSON formati settings.yml icinde acik olmali.",
        )
        search_timeout: int = Field(default=12, description="SearXNG arama zaman asimi (saniye).")
        fetch_timeout: int = Field(default=20, description="Sayfa indirme zaman asimi (saniye).")
        max_results: int = Field(default=5, description="Aramada donecek maksimum sonuc sayisi (1-10).")
        read_count: int = Field(default=3, description="search_and_read kact sayfayi tam okusun (1-6).")
        max_chars_per_page: int = Field(default=3500, description="Sayfa basina modele verilecek maksimum karakter.")
        max_total_chars: int = Field(default=14000, description="Bir arac cagrisinda toplam karakter butcesi.")
        enable_stealth_browser: bool = Field(
            default=True, description="Cloudflare/JS korumali sitelerde Scrapling StealthyFetcher kullan."
        )
        use_cache: bool = Field(default=True, description="Arama ve sayfa sonuclarini TTL cache ile sakla.")
        cache_ttl_minutes: int = Field(default=90, description="Cache gecerlilik suresi (dakika).")
        max_concurrent_fetches: int = Field(default=3, description="Paralel sayfa okuma sayisi (1-6).")
        search_language: str = Field(default="auto", description="Arama dili: auto, en, tr, de ...")
        default_categories: str = Field(
            default="general",
            description="Varsayilan kategori. Virgulle birden fazla verilebilir: general,it veya news,general",
        )
        engines: str = Field(
            default="",
            description="Instance destekliyorsa sinirlandirilacak motorlar (ornek yandex veya duckduckgo,google). Bos = instance varsayilani.",
        )
        safesearch: int = Field(default=1, description="Safesearch: 0 yok, 1 orta, 2 siki.")
        allow_private_urls: bool = Field(
            default=False, description="read_url icin ozel/yerel ag adreslerine izin ver (SSRF riski)."
        )
        blocked_domains: str = Field(default="", description="Okunmayacak alan adlari, virgul ile ayrilmis.")
        github_token: str = Field(
            default=os.environ.get("GITHUB_TOKEN", ""),
            description="Istege bagli GitHub token (rate limit ve code arama icin gereklidir).",
        )
        emit_citations: bool = Field(default=True, description="Okunan kaynaklari Open WebUI citation event olarak goster.")
        debug_logging: bool = Field(default=False, description="Sunucu log'una ayiklama satirlari yaz.")

    class UserValves(BaseModel):
        max_results: int = Field(default=0, description="Kullanici bazli sonuc sayisi (0 = admin varsayilani).")
        max_chars_per_page: int = Field(default=0, description="Kullanici bazli sayfa karakter limiti (0 = admin varsayilani).")

    # ------------------------------------------------------------------
    # 1) Zaman
    # ------------------------------------------------------------------
    async def get_current_time(self, timezone_name: str = "local") -> str:
        """
        Returns the current date and time, optionally in a specific IANA timezone.
        Use this whenever the question depends on 'today', 'now', 'this week' or model freshness.
        :param timezone_name: 'local' veya IANA saat dilimi adi, ornek Europe/Istanbul, UTC, America/New_York.
        """
        now_utc = datetime.now(timezone.utc)
        local = now_utc.astimezone()

        tz_note = ""
        name = (timezone_name or "local").strip()
        if name and name.lower() != "local":
            try:
                from zoneinfo import ZoneInfo  # stdlib (Python 3.9+)

                target = now_utc.astimezone(ZoneInfo(name))
                tz_note = f"\n{name} = {target.strftime('%A, %B %d %Y %H:%M:%S %Z')}"
            except Exception:
                tz_note = f"\n(bilinmeyen saat dilimi: {name})"

        return (
            f"UTC   = {now_utc.strftime('%A, %B %d %Y %H:%M:%S UTC')}\n"
            f"Local = {local.strftime('%A, %B %d %Y %H:%M:%S %Z')}"
            f"{tz_note}\n"
            f"ISO   = {now_utc.isoformat()}\n"
            f"Unix  = {int(now_utc.timestamp())}"
        )

    # ------------------------------------------------------------------
    # 2) Hizli arama (yalnizca snippet, sayfa okumaz)
    # ------------------------------------------------------------------
    async def search_web(
        self,
        query: str,
        max_results: int = 5,
        category: str = "",
        time_range: str = "",
        language: str = "",
        page: int = 1,
        __event_emitter__=None,
    ) -> str:
        """
        Searches the web and returns titles, URLs and snippets WITHOUT reading full pages.
        Fast and cheap: use it to discover sources, then call read_url on the promising ones.
        :param query: Search query. Supports operators like site:github.com, "exact phrase", -exclude.
        :param max_results: How many results to return (1-10). 0 = admin default.
        :param category: SearXNG category; several at once with a comma works too, e.g. general, it, news, science or 'general,it' for technical topics.
        :param time_range: Optional freshness filter: day, week, month or year. Empty means all time.
        :param language: Search language code such as tr, en, de. Empty = admin default.
        :param page: Result page number (1+) when the first page is not enough.
        """
        valves = self._effective_valves()
        limit = self._clamp(max_results, 0, 10) or valves.max_results
        await self._emit(__event_emitter__, "status", f"Araniyor: {query}")

        results, extra = await asyncio.to_thread(
            self._search, query, valves, category, time_range, self._clamp(page, 1, 10), language
        )
        if not results:
            return f"'{query}' icin sonuc bulunamadi. {extra}".strip()

        results = self._dedupe_results(results)[:limit]
        await self._emit_citations(__event_emitter__, results, valves)
        await self._emit(__event_emitter__, "status", f"{len(results)} kaynak bulundu", done=True)

        blocks: list[str] = []
        for i, r in enumerate(results, 1):
            snippet = _truncate(r.get("content", ""), 400)
            blocks.append(
                f"[{i}] {r.get('title') or '(basliksiz)'}\n"
                f"    URL: {r['url']}\n"
                f"    {self._source_meta_line(r, include_url=False)}\n"
                f"    {snippet}"
            )
        if extra:
            blocks.append(extra)
        return "\n\n".join(blocks)

    # ------------------------------------------------------------------
    # 3) Arama + tam sayfa okuma (derin arastirma)
    # ------------------------------------------------------------------
    async def search_and_read(
        self,
        query: str,
        max_results: int = 3,
        category: str = "",
        time_range: str = "",
        language: str = "",
        page: int = 1,
        __event_emitter__=None,
    ) -> str:
        """
        Searches the web then reads the FULL content of the top result pages and returns them.
        Use this for factual, current or technical questions that need real page content.
        :param query: Search query. Add site:/-exclude/"exact" operators to sharpen results.
        :param max_results: How many pages to fetch fully (1-6). 0 = admin default.
        :param category: SearXNG category; 'general,it' (comma separated) widens technical searches, 'news' for current events.
        :param time_range: Optional freshness filter: day, week, month or year.
        :param language: Search language code such as tr, en, de. Empty = admin default.
        :param page: Result page number (1+) when the first page is not enough.
        """
        valves = self._effective_valves()
        limit = self._clamp(max_results, 0, 6) or valves.read_count
        await self._emit(__event_emitter__, "status", f"Araniyor: {query}")

        results, extra = await asyncio.to_thread(
            self._search, query, valves, category, time_range, self._clamp(page, 1, 10), language
        )
        results = self._dedupe_results(results, per_domain=2)[:limit]
        if not results:
            return f"'{query}' icin sonuc bulunamadi. {extra}".strip()

        await self._emit(__event_emitter__, "status", f"{len(results)} sayfa okunuyor...")
        pages = await self._read_many([r["url"] for r in results], valves)

        blocks: list[str] = []
        budget = max(2000, valves.max_total_chars)
        used = 0
        for i, (r, page) in enumerate(zip(results, pages), 1):
            if page.get("ok"):
                body = _truncate(page["text"], self._page_limit(valves, page))
            else:
                # Sayfa okunamadiysa en azindan arama snippet'ini modele ver
                body = _truncate(r.get("content", "") or "Icerik alinamadi.", 500)
            used += len(body)
            blocks.append(
                f"### [{i}] {page.get('title') or r.get('title') or '(basliksiz)'}\n"
                f"{self._source_meta_line(r, page)}\n\n{body}"
            )
            if used >= budget:
                skipped = len(results) - i
                if skipped > 0:
                    blocks.append(
                        f"_{skipped} kaynak karakter butcesi nedeniyle atlandi, gerekirse read_url ile okunabilir._"
                    )
                break

        await self._emit_citations(__event_emitter__, [dict(r, **p) for r, p in zip(results, pages)], valves)
        await self._emit(__event_emitter__, "status", "Arama tamamlandi", done=True)
        return "\n\n---\n\n".join(blocks)

    # ------------------------------------------------------------------
    # 4) Tek URL okuma
    # ------------------------------------------------------------------
    async def read_url(self, url: str, max_chars: int = 0, __event_emitter__=None) -> str:
        """
        Reads the full text content of a single web page.
        Handles Cloudflare/JS protected sites, converts GitHub blob links to raw, strips boilerplate.
        :param url: Absolute page URL (http/https).
        :param max_chars: Character limit for this call. 0 = admin default value.
        """
        valves = self._effective_valves()
        await self._emit(__event_emitter__, "status", f"Okunuyor: {url}")
        page = await self._read_page(url, valves)

        if not page.get("ok"):
            await self._emit(__event_emitter__, "notification", f"Sayfa okunamadi: {page.get('error')}")
            return f"Sayfa okunamadi ({url}): {page.get('error')}"

        limit = self._clamp(max_chars, 0, 60000) or valves.max_chars_per_page
        await self._emit_citations(__event_emitter__, [page], valves)
        await self._emit(__event_emitter__, "status", "Sayfa okundu", done=True)
        return (
            f"{page.get('title') or url}\n"
            f"{self._source_meta_line(page, page)}\n\n"
            f"{_truncate(page['text'], limit)}"
        )

    # ------------------------------------------------------------------
    # 5) Toplu / paralel URL okuma
    # ------------------------------------------------------------------
    async def read_urls(self, urls: list[str], max_chars_per_page: int = 0, __event_emitter__=None) -> str:
        """
        Reads several web pages in parallel and returns their content in one call.
        Prefer this over calling read_url repeatedly when you already know the URLs.
        :param urls: List of absolute page URLs (max 8 per call).
        :param max_chars_per_page: Character limit per page. 0 = admin default value.
        """
        valves = self._effective_valves()
        targets = [u.strip() for u in (urls or []) if u and u.strip()][:8]
        if not targets:
            return "URL listesi bos."

        await self._emit(__event_emitter__, "status", f"{len(targets)} sayfa paralel okunuyor...")
        pages = await self._read_many(targets, valves)
        limit = self._clamp(max_chars_per_page, 0, 30000) or valves.max_chars_per_page

        blocks: list[str] = []
        budget = max(2000, valves.max_total_chars)
        used = 0
        for i, (u, page) in enumerate(zip(targets, pages), 1):
            if not page.get("ok"):
                blocks.append(f"### [{i}] {u}\nOkunamadi: {page.get('error')}")
                continue
            body = _truncate(page["text"], min(limit, max(600, budget - used)))
            used += len(body)
            blocks.append(
                f"### [{i}] {page.get('title') or u}\n{self._source_meta_line(page, page)}\n\n{body}"
            )

        await self._emit_citations(__event_emitter__, [p for p in pages if p.get("ok")], valves)
        await self._emit(__event_emitter__, "status", "Sayfalar okundu", done=True)
        return "\n\n---\n\n".join(blocks)

    # ------------------------------------------------------------------
    # 6) Sayfadaki linkleri listele (dokumantasyonda gezinme)
    # ------------------------------------------------------------------
    async def list_links(self, url: str, contains: str = "", max_links: int = 40) -> str:
        """
        Lists the links found on a page. Useful to navigate documentation sites and find the exact page to read next.
        :param url: Page URL whose links will be listed.
        :param contains: Only keep links containing this text (case-insensitive), e.g. 'install' or 'api'.
        :param max_links: Maximum number of links to return (1-100).
        """
        valves = self._effective_valves()
        target = self._github_to_raw(url)
        guard_error = self._guard_url(target, valves)
        if guard_error:
            return f"Sayfa okunamadi ({url}): {guard_error}"

        html = await asyncio.to_thread(self._fetch_best_html, target, valves)
        if not html:
            return f"{url} icin HTML alinamadi (bot korumasi veya erisilemedi)."

        links = await asyncio.to_thread(self._extract_links, target, html, valves)
        needle = (contains or "").strip().lower()
        if needle:
            links = [l for l in links if needle in l["url"].lower() or needle in l["title"].lower()]
        links = links[: self._clamp(max_links, 0, 100) or 40]
        if not links:
            return f"{url} icinde eslesen link bulunamadi."

        out = [f"Linkler ({len(links)}) — {url}"]
        for l in links:
            out.append(f"- {l['title'] or '(etiketsiz)'} -> {l['url']}")
        return "\n".join(out)

    # ==================================================================
    # YARDIMCI METODLAR ( "_" ile baslar -> LLM'e arac olarak gosterilmez )
    # ==================================================================
    def _effective_valves(self, __user__=None):
        """Admin valve'lari + varsa kullanicinin UserValves override'lari."""
        valves = self.valves
        try:
            user_valves = (__user__ or {}).get("valves") if isinstance(__user__, dict) else getattr(__user__, "valves", None)
            if user_valves is None:
                return valves
            merged = valves.model_dump()
            for key, value in (user_valves.model_dump() if hasattr(user_valves, "model_dump") else dict(user_valves)).items():
                if key in merged and value not in (None, "", 0):
                    merged[key] = value
            return self.Valves(**merged)
        except Exception:
            return valves

    @staticmethod
    def _clamp(value: Any, low: int, high: int) -> int:
        try:
            n = int(value)
        except Exception:
            return low
        return max(low, min(high, n))

    async def _emit(self, emitter, event_type: str, text: str, done: bool = False) -> None:
        """Native modda guvenli event'ler: status / notification."""
        if not emitter:
            return
        try:
            if event_type == "status":
                await emitter({"type": "status", "data": {"description": text, "done": done}})
            else:
                await emitter({"type": "notification", "data": {"content": text}})
        except Exception as exc:  # UI event hatasi araci bozmamali
            _log(self.valves.debug_logging, f"event emit hatasi: {exc}")

    async def _emit_citations(self, emitter, items: list[dict], valves) -> None:
        if not emitter or not valves.emit_citations:
            return
        for item in items[:8]:
            url = item.get("url")
            if not url:
                continue
            title = item.get("title") or _domain_of(url)
            snippet = _truncate(item.get("content") or item.get("text") or "", 600)
            meta = {"date_accessed": datetime.now(timezone.utc).isoformat(), "source": title, "url": url}
            if item.get("site"):
                meta["site_name"] = item["site"]
            if item.get("published_date"):
                meta["publication_date"] = item["published_date"]
            try:
                await emitter(
                    {
                        "type": "citation",
                        "data": {
                            "document": [snippet] if snippet else [title],
                            "metadata": [meta],
                            "source": {"name": title, "url": url},
                        },
                    }
                )
            except Exception as exc:
                _log(valves.debug_logging, f"citation hatasi: {exc}")

    def _page_limit(self, valves, page: dict | None = None) -> int:
        limit = valves.max_chars_per_page
        # Kod/dosya icerikleri daha uzun okunabilir
        if page and page.get("content_type") == "code":
            limit = max(limit, min(12000, valves.max_total_chars // 2))
        return max(600, limit)

    @staticmethod
    def _source_meta_line(source: dict, page: dict | None = None, include_url: bool = True) -> str:
        parts = [f"URL: {source.get('url', '')}"] if include_url else []
        site = (page or {}).get("site") or source.get("site") or _domain_of(source.get("url", ""))
        if site:
            parts.append(f"Site: {site}")
        date = (page or {}).get("published_date") or source.get("publishedDate") or source.get("published_date")
        if date:
            parts.append(f"Yayin: {str(date)[:10]}")
        via = (page or {}).get("via")
        if via:
            parts.append(f"Okuma: {via}")
        engine = source.get("engine")
        if engine:
            parts.append(f"Motor: {engine}")
        return " • ".join(parts)

    @staticmethod
    def _dedupe_results(results: list[dict], per_domain: int = 1) -> list[dict]:
        seen_url: set[str] = set()
        domain_count: dict[str, int] = {}
        out: list[dict] = []
        for r in results:
            url = (r or {}).get("url") or ""
            if not url.startswith("http"):
                continue
            key = _normalize_url(url)
            if key in seen_url:
                continue
            domain = _domain_of(url)
            if domain_count.get(domain, 0) >= per_domain:
                continue
            seen_url.add(key)
            domain_count[domain] = domain_count.get(domain, 0) + 1
            out.append(r)
        return out

    # -------------------------- Arama ---------------------------------
    def _search(
        self,
        query: str,
        valves,
        category: str,
        time_range: str,
        pageno: int,
        language: str = "",
    ) -> tuple[list[dict], str]:
        """SearXNG JSON; olamazsa DuckDuckGo/Bing HTML yedegi. Sonuc + ek bilgi doner."""
        key = f"{query}|{category or valves.default_categories}|{time_range}|{pageno}|{language or valves.search_language}"
        if valves.use_cache:
            cached = _cache_get(_SEARCH_CACHE, key, valves.cache_ttl_minutes * 60)
            if cached is not None:
                _log(valves.debug_logging, f"arama cache hit: {query}")
                return cached, ""

        results: list[dict] = []
        extra: list[str] = []
        errors: list[str] = []

        try:
            results, instant = self._searxng(query, valves, category, time_range, pageno, language)
            extra.extend(instant)
        except Exception as exc:
            errors.append(f"SearXNG: {exc}")
            _log(valves.debug_logging, f"searxng hatasi: {exc}")

        if not results:
            for engine in (self._duckduckgo, self._bing):
                try:
                    results = engine(query, 10)
                    if results:
                        extra.append(f"(SearXNG kullanilamadi, {engine.__name__.lstrip('_')} yedegi kullanildi)")
                        break
                except Exception as exc:
                    errors.append(f"{engine.__name__}: {exc}")

        if not results and errors:
            return [], " | ".join(errors)

        if valves.use_cache and results:
            _cache_put(_SEARCH_CACHE, key, results)
        return results, " ".join(extra).strip()

    def _searxng(
        self,
        query: str,
        valves,
        category: str,
        time_range: str,
        pageno: int,
        language: str = "",
    ) -> tuple[list[dict], list[str]]:
        base = (valves.searxng_url or "").rstrip("/")
        if not base:
            raise RuntimeError("searxng_url valve'i bos")

        params: dict[str, str] = {
            "q": query,
            "format": "json",
            "categories": (category or valves.default_categories or "general").strip(),
            "pageno": str(max(1, pageno)),
            "safesearch": str(self._clamp(valves.safesearch, 0, 2)),
        }
        lang = (language or valves.search_language or "auto").strip()
        if lang and lang.lower() != "auto":
            params["language"] = lang
        engines = (valves.engines or "").strip()
        if engines:
            params["engines"] = engines
        tr = (time_range or "").strip().lower()
        if tr in ("day", "week", "month", "year"):
            params["time_range"] = tr

        resp = requests.get(f"{base}/search", params=params, timeout=valves.search_timeout, headers={"User-Agent": _UA})
        if resp.status_code == 403:
            raise RuntimeError("SearXNG JSON formati kapali (403). settings.yml > search.formats icine json eklenmeli")
        resp.raise_for_status()
        data = resp.json()

        results: list[dict] = []
        for r in data.get("results", []) or []:
            url = _unwrap_redirect((r.get("url") or "").strip())
            engine_names = r.get("engine") or ",".join(r.get("engines") or [])
            results.append(
                {
                    "title": (r.get("title") or "").strip(),
                    "url": url,
                    "content": _tidy_text(r.get("content") or "")[:600],
                    "site": r.get("hostname") or _domain_of(url),
                    "publishedDate": r.get("publishedDate") or "",
                    "engine": engine_names,
                }
            )

        instant: list[str] = []
        for answer in data.get("answers") or []:
            if isinstance(answer, str) and answer.strip():
                instant.append(f"SearXNG hizli cevap: {answer.strip()}")
        infobox = data.get("infobox") or {}
        if isinstance(infobox, dict) and infobox.get("content"):
            instant.append(f"Bilgi kutusu ({infobox.get('title', '')}): {_truncate(infobox['content'], 500)}")
        suggestions = data.get("suggestions") or []
        if suggestions:
            instant.append("Iliskili sorgular: " + ", ".join(str(s) for s in suggestions[:5]))

        # Hangi motorlar cevap verdi (instance ayarini gormek icin faydali)
        used_engines = sorted({e for r in results for e in (r.get("engine") or "").split(",") if e})
        if used_engines:
            _log(valves.debug_logging, f"motorlar: {', '.join(used_engines)}")
        if len(results) < 3:
            instant.append(
                "Sonuc sayisi az; category='general,it' gibi ek kategori veya page=2 deneyin."
            )

        _log(valves.debug_logging, f"searxng {len(results)} sonuc ({params['categories']})")
        return results, instant

    def _duckduckgo(self, query: str, limit: int) -> list[dict]:
        resp = requests.post(
            "https://html.duckduckgo.com/html/",
            data={"q": query, "kl": "wt-wt"},
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
            timeout=15,
        )
        resp.raise_for_status()
        if BeautifulSoup is None:
            raise RuntimeError("BeautifulSoup kurulu degil")
        soup = BeautifulSoup(resp.text, "html.parser")
        out: list[dict] = []
        for block in soup.select(".result"):
            a = block.select_one("a.result__a") or block.select_one("h2 a")
            if not a or not a.get("href"):
                continue
            href = a["href"]
            if href.startswith("/"):
                href = "https://duckduckgo.com" + href
            href = _unwrap_redirect(href)
            if not href.startswith("http"):
                continue
            snippet_el = block.select_one(".result__snippet")
            out.append(
                {
                    "title": a.get_text(" ", strip=True),
                    "url": href,
                    "content": _tidy_text(snippet_el.get_text(" ", strip=True) if snippet_el else "")[:600],
                    "site": _domain_of(href),
                    "publishedDate": "",
                }
            )
            if len(out) >= limit:
                break
        return out

    def _bing(self, query: str, limit: int) -> list[dict]:
        resp = requests.get(
            "https://www.bing.com/search",
            params={"q": query, "count": max(10, limit)},
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.9"},
            timeout=15,
        )
        resp.raise_for_status()
        if BeautifulSoup is None:
            raise RuntimeError("BeautifulSoup kurulu degil")
        soup = BeautifulSoup(resp.text, "html.parser")
        out: list[dict] = []
        for block in soup.select("li.b_algo"):
            a = block.select_one("h2 a")
            if not a or not a.get("href"):
                continue
            href = _unwrap_redirect(a["href"])
            if not href.startswith("http"):
                continue
            snippet_el = block.select_one(".b_caption p") or block.select_one("p")
            out.append(
                {
                    "title": a.get_text(" ", strip=True),
                    "url": href,
                    "content": _tidy_text(snippet_el.get_text(" ", strip=True) if snippet_el else "")[:600],
                    "site": _domain_of(href),
                    "publishedDate": "",
                }
            )
            if len(out) >= limit:
                break
        return out

    # -------------------------- Sayfa okuma ---------------------------
    def _github_to_raw(self, url: str) -> str:
        """github.com/x/blob/branch/path -> raw.githubusercontent.com/x/branch/path"""
        url = (url or "").strip()
        if "github.com" in url and "/blob/" in url:
            url = url.replace("https://github.com", "https://raw.githubusercontent.com")
            url = url.replace("/blob/", "/")
        return url

    def _guard_url(self, url: str, valves) -> str | None:
        """SSRF korumasi: semasi, alan adi karalistesi ve ozel IP kontrolu. Hata metni veya None."""
        try:
            parsed = urlparse(url)
        except Exception:
            return "gecersiz URL"
        if parsed.scheme not in ("http", "https"):
            return f"desteklenmeyen sema: {parsed.scheme or '(yok)'}"
        host = parsed.hostname or ""
        if not host:
            return "alan adi yok"

        blocked = [d.strip().lower() for d in (valves.blocked_domains or "").split(",") if d.strip()]
        domain = _domain_of(url)
        for bad in blocked:
            if domain == bad or domain.endswith("." + bad):
                return f"karalistadaki alan adi: {bad}"

        if valves.allow_private_urls:
            return None
        try:
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            infos = socket.getaddrinfo(host, port, proto=socket.IPPROTO_TCP)
        except socket.gaierror:
            return f"DNS cozumlenemedi: {host}"
        except Exception as exc:
            return f"alan adi cozumlenemedi: {exc}"
        for info in infos:
            try:
                ip = ipaddress.ip_address(info[4][0])
            except Exception:
                continue
            if (
                ip.is_private
                or ip.is_loopback
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
                or ip.is_unspecified
            ):
                return f"ozel/yerel ag adresi engellendi: {host} -> {ip}"
        return None

    async def _read_many(self, urls: list[str], valves) -> list[dict]:
        """URL'leri sinirli eszamanliliktla paralel okur."""
        sem = asyncio.Semaphore(self._clamp(valves.max_concurrent_fetches, 1, 6))

        async def one(url: str) -> dict:
            async with sem:
                return await self._read_page(url, valves)

        return list(await asyncio.gather(*(one(u) for u in urls)))

    def _fetch_best_html(self, url: str, valves) -> str:
        """Katmanli fetch: en iyi HTML'i doner (bot korumali sayfayi da donerdiger)."""
        candidates: list[tuple[str, int, str]] = []
        for name, loader in (
            ("scrapling-static", lambda: self._fetch_static(url, valves)),
            ("requests", lambda: self._fetch_requests(url, valves)),
            ("trafilatura", lambda: self._fetch_trafilatura(url)),
        ):
            try:
                status_code, html = loader()
            except Exception as exc:
                _log(valves.debug_logging, f"{name} hatasi: {exc}")
                continue
            if not html:
                continue
            candidates.append((name, status_code, html))
            if not _looks_blocked(html):
                break  # temiz icerik bulundu, daha agir katmana gerek yok
        if not candidates:
            return ""
        # En uzun HTML'i sec (bot sayfasi genelde kisa olur)
        best = max(candidates, key=lambda c: len(c[2]))
        _log(valves.debug_logging, f"html katmani: {best[0]} ({best[1]}) {len(best[2])} bayt")
        return best[2]

    def _read_page_core(self, url: str, valves) -> tuple[dict, bool]:
        """Cache + katmanli fetch + metin cikarma. (sayfa, tarayici_gerekir) doner."""
        url = self._github_to_raw(url or "")
        if not url:
            return {"ok": False, "url": url, "error": "bos URL"}, False

        guard_error = self._guard_url(url, valves)
        if guard_error:
            return {"ok": False, "url": url, "error": guard_error}, False

        key = _normalize_url(url)
        ttl = valves.cache_ttl_minutes * 60
        if valves.use_cache:
            cached = _cache_get(_PAGE_CACHE, key, ttl)
            if cached is not None:
                _log(valves.debug_logging, f"sayfa cache hit: {key}")
                cached_copy = dict(cached)
                cached_copy["cached"] = True
                return cached_copy, False

        html = self._fetch_best_html(url, valves)
        extracted = self._extract_text(html, url) if html else {"title": "", "text": "", "meta": {}}

        browser_needed = bool(
            _StealthFetcher is not None
            and valves.enable_stealth_browser
            and (
                not html
                or _looks_blocked(html)
                # Kisa ama zengin HTML'den az metin cikmasi -> JS render ihtimali
                or (len(extracted.get("text", "")) < 400 and len(html) > 2000)
            )
        )
        partial = {
            "ok": bool(extracted.get("text")),
            "url": url,
            "key": key,
            "title": extracted.get("title") or "",
            "text": extracted.get("text", ""),
            "meta": extracted.get("meta", {}),
            "via": "http",
        }
        return partial, browser_needed

    def _finalize_page(self, url: str, key: str, extracted: dict, via: str, valves) -> dict:
        """Sayfa sozlugunu kurar ve cache'e yazar."""
        if not extracted.get("text"):
            return {
                "ok": False,
                "url": url,
                "error": "icerik cikarilamadi (bot korumasi, bos sayfa veya desteklenmeyen format)",
            }

        page = {
            "ok": True,
            "url": url,
            "title": extracted.get("title") or _domain_of(url),
            "text": extracted["text"],
            "site": _domain_of(url),
            "published_date": (extracted.get("meta") or {}).get("date", ""),
            "via": via,
            "content_type": "code" if url.startswith("https://raw.githubusercontent.com") else "page",
        }
        if valves.use_cache:
            _cache_put(_PAGE_CACHE, key, dict(page))
        _log(valves.debug_logging, f"okundu ({via}) {len(page['text'])} karakter: {url}")
        return page

    async def _read_page(self, url: str, valves) -> dict:
        """Tek sayfa okur. Her zaman dict doner (ok/error/title/text)."""
        partial, browser_needed = await asyncio.to_thread(self._read_page_core, url, valves)
        if partial.get("cached") or not partial.get("key"):
            partial.pop("cached", None)
            return partial

        extracted = {"title": partial["title"], "text": partial["text"], "meta": partial["meta"]}
        via = partial["via"]

        # Icerik zayif/kilitliyse tarayici katmanina cik (Cloudflare / JS siteleri)
        if browser_needed:
            browser_html = await self._fetch_browser(partial["url"], valves)
            if browser_html:
                from_browser = await asyncio.to_thread(self._extract_text, browser_html, partial["url"])
                if len(from_browser.get("text", "")) > len(extracted.get("text", "")):
                    extracted, via = from_browser, "scrapling-browser"

        return self._finalize_page(partial["url"], partial["key"], extracted, via, valves)

    def _fetch_static(self, url: str, valves) -> tuple[int, str]:
        """Scrapling Fetcher (curl_cffi, tarayici parmak izi) — hizli katman (~0.1-1s)."""
        if _StaticFetcher is None:
            raise RuntimeError("scrapling kurulu degil")
        page = _StaticFetcher.get(
            url,
            timeout=self._clamp(valves.fetch_timeout, 3, 90),
            impersonate="chrome",
            follow_redirects=True,
        )
        return int(page.status or 0), page.html_content or ""

    def _fetch_requests(self, url: str, valves) -> tuple[int, str]:
        """Duz requests yedegi."""
        resp = requests.get(
            url,
            timeout=self._clamp(valves.fetch_timeout, 3, 90),
            headers={"User-Agent": _UA, "Accept-Language": "en-US,en;q=0.8", "Accept": "text/html,application/xhtml+xml,*/*"},
            allow_redirects=True,
        )
        # Yonlendirme ozel bir adrese gittiyse icerigi kullanma (SSRF)
        if resp.url and _domain_of(resp.url) != _domain_of(url):
            redirect_error = self._guard_url(resp.url, valves)
            if redirect_error:
                raise RuntimeError(f"guvenli olmayan yonlendirme: {redirect_error}")
        return int(resp.status_code), resp.text or ""

    @staticmethod
    def _fetch_trafilatura(url: str) -> tuple[int, str]:
        if trafilatura is None:
            raise RuntimeError("trafilatura kurulu degil")
        downloaded = trafilatura.fetch_url(url)
        if not downloaded:
            return 0, ""
        return 200, downloaded

    async def _fetch_browser(self, url: str, valves) -> str:
        """Scrapling StealthyFetcher (async) — agir katman, Cloudflare cozme ve JS render."""
        if _StealthFetcher is None:
            return ""
        async with _stealth_lock():  # browser acmak pahali: eszamanli headless surec cogaltma
            try:
                page = await _StealthFetcher.async_fetch(
                    url,
                    headless=True,
                    network_idle=True,
                    solve_cloudflare=True,
                    block_ads=True,
                    timeout=self._clamp(valves.fetch_timeout, 3, 90) * 1000,
                )
            except Exception as exc:
                _log(valves.debug_logging, f"browser hatasi: {exc}")
                return ""
        if not page or int(getattr(page, "status", 0) or 0) >= 400:
            return ""
        return page.html_content or ""

    @staticmethod
    def _extract_text(html: str, url: str) -> dict:
        """HTML'den baslik + tarih + govde metin cikarir (trafilatura oncelikli)."""
        title = ""
        date = ""
        text = ""

        if trafilatura is not None and html:
            try:
                raw = trafilatura.extract(
                    html,
                    url=url,
                    output_format="json",
                    with_metadata=True,
                    include_comments=False,
                    include_tables=True,
                    favor_recall=True,
                )
                data = json.loads(raw) if raw else None
                if isinstance(data, list):
                    data = data[0] if data else {}
                if isinstance(data, dict):
                    title = (data.get("title") or "").strip()
                    date = (data.get("date") or "").strip()
                    text = _tidy_text(data.get("text") or "")
            except Exception:
                text = ""
            if not text:  # metadata modu basarisizsa duz metin dene
                try:
                    text = _tidy_text(
                        trafilatura.extract(
                            html, url=url, include_comments=False, include_tables=True, favor_recall=True
                        )
                        or ""
                    )
                except Exception:
                    text = ""

        if len(text) < 400 and BeautifulSoup is not None and html:
            soup = BeautifulSoup(html, "html.parser")
            for tag in soup(["script", "style", "noscript", "nav", "footer", "header", "aside", "form", "svg"]):
                tag.decompose()
            if not title:
                og = soup.find("meta", attrs={"property": "og:title"})
                title = (og.get("content") or "").strip() if og else ""
            if not title and soup.title:
                title = soup.title.get_text(strip=True)
            main = soup.select_one("main") or soup.select_one("article") or soup.select_one("[role=main]")
            candidate = _tidy_text((main or soup).get_text("\n"))
            if len(candidate) > len(text):
                text = candidate

        return {"title": title, "text": text, "meta": {"date": date}}

    def _extract_links(self, base_url: str, html: str, valves) -> list[dict]:
        """Sayfadaki linkleri mutlak URL'ye cevirip listeler (ayni alan oncelikli)."""
        if BeautifulSoup is None or not html:
            return []

        soup = BeautifulSoup(html, "html.parser")
        base_domain = _domain_of(base_url)
        internal: list[dict] = []
        external: list[dict] = []
        seen: set[str] = set()
        for a in soup.find_all("a", href=True):
            href = a["href"].strip()
            if href.startswith(("#", "javascript:", "mailto:")):
                continue
            absolute = urljoin(base_url, href)
            if not absolute.startswith(("http://", "https://")):
                continue
            key = _normalize_url(absolute)
            if key in seen or key == _normalize_url(base_url):
                continue
            seen.add(key)
            title = a.get_text(" ", strip=True)[:120]
            item = {"title": title, "url": absolute}
            (internal if _domain_of(absolute) == base_domain else external).append(item)
        return internal + external

    # -------------------------- GitHub --------------------------------
    def _gh_headers(self, valves) -> dict:
        headers = {
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "openwebui-websearchtool",
        }
        if valves.github_token:
            headers["Authorization"] = f"Bearer {valves.github_token}"
        return headers

    def _gh_api(self, path: str, params: dict | None, valves) -> tuple[Any, str]:
        """GitHub REST API cagrisi. (veri, hata_mesaji) doner; hata yoksa hata_mesaji bos."""
        try:
            resp = requests.get(
                f"https://api.github.com{path}",
                params=params or {},
                headers=self._gh_headers(valves),
                timeout=15,
            )
        except Exception as exc:
            return None, f"GitHub API erisim hatasi: {exc}"
        if resp.status_code == 403 and "rate limit" in resp.text.lower():
            reset = resp.headers.get("X-RateLimit-Reset", "")
            return None, (
                "GitHub API rate limit doldu. Valves > github_token alanina token girin"
                + (f" (sifirlama: {reset})" if reset else "")
            )
        if resp.status_code == 401:
            return None, "GitHub token gecersiz/suresi dolmus (401)"
        if resp.status_code == 404:
            return None, "bulunamadi (404)"
        try:
            return resp.json(), ""
        except Exception:
            return None, f"GitHub API beklenmeyen yanit ({resp.status_code})"

    @staticmethod
    def _normalize_repo(repo: str) -> str:
        """'https://github.com/owner/repo/blob/main/x' -> 'owner/repo'"""
        repo = (repo or "").strip().strip("/")
        if not repo:
            return ""
        if "github.com" in repo:
            path = urlparse(repo).path.strip("/")
            parts = path.split("/")
            if len(parts) >= 2:
                repo = f"{parts[0]}/{parts[1]}"
            else:
                return ""
        repo = repo.replace("git+", "").removesuffix(".git")
        parts = repo.split("/")
        return "/".join(parts[:2]) if len(parts) >= 2 else ""

    async def github_search(
        self,
        query: str,
        search_type: str = "repositories",
        max_results: int = 8,
        language: str = "",
    ) -> str:
        """
        Searches GitHub for repositories or topics (code search needs a github_token valve).
        Use it to find libraries, examples and open source implementations before reading files.
        :param query: Search terms. GitHub qualifiers work too, e.g. 'scrapling stars:>500' or 'topic:web-search'.
        :param search_type: repositories, topics or code (code requires github_token valve).
        :param max_results: How many items to return (1-20).
        :param language: Optional language filter for repositories, e.g. python, typescript.
        """
        valves = self._effective_valves()
        kind = (search_type or "repositories").strip().lower()
        limit = self._clamp(max_results, 0, 20) or 8

        if kind not in ("repositories", "topics", "code"):
            return "search_type degeri repositories, topics veya code olmali."
        if kind == "code" and not valves.github_token:
            return (
                "GitHub 'code' aramasi kimlik dogrulama ister. Valves > github_token alanina token girin "
                "veya search_web araciyla 'site:github.com <terim>' aramasini kullanin."
            )

        params: dict[str, Any] = {"q": query, "per_page": limit}
        if kind == "repositories":
            params["sort"] = "stars"
            params["order"] = "desc"
            if language:
                params["q"] = f"{query} language:{language}"

        data, error = await asyncio.to_thread(self._gh_api, f"/search/{kind}", params, valves)
        if error:
            return f"GitHub arama hatasi: {error}"

        items = (data or {}).get("items", []) if isinstance(data, dict) else []
        if not items:
            return f"GitHub'da sonuc bulunamadi: {query}"

        out: list[str] = []
        for item in items[:limit]:
            if kind == "repositories":
                desc = _truncate((item.get("description") or "").strip(), 200) or "(aciklama yok)"
                topics = ", ".join(item.get("topics") or [])
                out.append(
                    f"**{item.get('full_name')}** ⭐{item.get('stargazers_count', 0)} "
                    f"[{item.get('language') or '-'}] güncel: {str(item.get('pushed_at', ''))[:10]}\n"
                    f"{desc}"
                    + (f"\nKonular: {topics}" if topics else "")
                    + f"\nURL: {item.get('html_url')}  (read_github_repo repo alanina '{item.get('full_name')}' yazin)"
                )
            elif kind == "code":
                repo = (item.get("repository") or {}).get("full_name", "")
                out.append(
                    f"**{repo}** — {item.get('path', '')}\nURL: {item.get('html_url')}\n"
                    f"{_truncate(item.get('fragment', '') or '', 300)}"
                )
            else:
                out.append(
                    f"**{item.get('name')}** ⭐{item.get('score', 0)}\n"
                    f"{item.get('short_description') or '(aciklama yok)'}"
                )
        total = (data or {}).get("total_count", len(items)) if isinstance(data, dict) else len(items)
        return f"GitHub {kind} aramasi: '{query}' ({total} sonuc, {len(out)} gosteriliyor)\n\n" + "\n\n".join(out)

    async def read_github_repo(
        self,
        repo: str,
        path: str = "",
        branch: str = "",
        max_chars: int = 0,
    ) -> str:
        """
        Reads a file or lists a directory of a GitHub repository using raw/API access.
        Works for README.md, docs, source files and repo trees; paste the full GitHub URL if you have one.
        :param repo: Repo adresi veya 'owner/repo'. Ornek: https://github.com/theroyallab/tabbyAPI
        :param path: Dosya veya klasyon yolu (README.md, src/main.py, docs/). Bos birakirsaniz repo agacini listeler.
        :param branch: Branch adi. Bos birakirsaniz varsayilan branch otomatik bulunur.
        :param max_chars: Dosya icerigi karakter limiti. 0 = admin varsayilani.
        """
        valves = self._effective_valves()
        repo_full = self._normalize_repo(repo)
        if not repo_full or repo_full.count("/") != 1:
            return "Gecersiz repo. Ornek: owner/repo veya https://github.com/owner/repo"

        meta, meta_error = await asyncio.to_thread(self._gh_api, f"/repos/{repo_full}", None, valves)
        resolved_branch = (branch or "").strip()
        if isinstance(meta, dict) and not resolved_branch:
            resolved_branch = meta.get("default_branch") or "main"
        if not resolved_branch:
            resolved_branch = "main"

        clean_path = (path or "").strip().lstrip("/")
        for prefix in ("blob/", "tree/"):
            if clean_path.startswith(prefix):
                clean_path = clean_path.split("/", 1)[1]
        if clean_path.startswith(f"{resolved_branch}/"):
            clean_path = clean_path[len(resolved_branch) + 1 :]

        header = ""
        if isinstance(meta, dict):
            header = (
                f"**{meta.get('full_name', repo_full)}** ⭐{meta.get('stargazers_count', 0)} "
                f"| branch: {resolved_branch} | dil: {meta.get('language') or '-'} "
                f"| guncel: {str(meta.get('pushed_at', ''))[:10]}\n"
                f"{_truncate(meta.get('description') or '', 300)}\n"
            )
        elif meta_error and meta_error != "bulunamadi (404)":
            return header + f"GitHub hatasi: {meta_error}"

        # Yol verilmediyse veya klasyor gibi gorunuyorsa agac listesi
        looks_like_dir = clean_path == "" or clean_path.endswith("/")
        if looks_like_dir:
            params = {"ref": resolved_branch}
            listing, error = await asyncio.to_thread(
                self._gh_api, f"/repos/{repo_full}/contents/{clean_path}", params, valves
            )
            if error and clean_path:
                # klasor yanlis olabilir: dosya olarak okumayi dene
                looks_like_dir = False
            elif error:
                return f"{header}\nRepo icerigi listelenemedi: {error}"
            elif isinstance(listing, list):
                dirs = [f"📁 {x['name']}/" for x in listing if x.get("type") == "dir"]
                files = [
                    f"📄 {x['name']} ({int(x.get('size', 0) / 1024)} KB)"
                    for x in listing
                    if x.get("type") == "file"
                ]
                others = [f"🔗 {x['name']}" for x in listing if x.get("type") not in ("dir", "file")]
                entries = (dirs + files + others)[:80]
                return (
                    f"{header}\n{clean_path or '/'} klasoru ({len(listing)} kayit, {len(entries)} gosteriliyor)\n"
                    + "\n".join(entries)
                    + "\n\n_Dosya okumak icin: read_github_repo(repo=..., path='dosya adi')_"
                )

        # Duz dosya icerigi (raw), branch yedekleriyle
        tried: list[str] = []
        branches = [resolved_branch] + [b for b in ("main", "master") if b != resolved_branch]
        for candidate_branch in branches:
            raw_url = f"https://raw.githubusercontent.com/{repo_full}/{candidate_branch}/{clean_path}"
            tried.append(raw_url)
            try:
                resp = requests.get(
                    raw_url, headers={"User-Agent": _UA, "Accept": "text/plain,*/*"}, timeout=self._clamp(valves.fetch_timeout, 3, 90)
                )
            except Exception as exc:
                continue
            if resp.status_code == 200:
                limit = self._clamp(max_chars, 0, 60000) or max(valves.max_chars_per_page, 6000)
                body = resp.text
                total_len = len(body)
                shown = _truncate(body, limit)
                note = "" if total_len <= limit else f"\n\n_{total_len} karakterin ilk {limit} kısmı gösteriliyor._"
                return (
                    f"{header}\nDosya: {clean_path} (branch: {candidate_branch}, {total_len} karakter)\n"
                    f"```\n{shown}\n```{note}"
                )
        return f"{header}\nDosya bulunamadi: {clean_path}\nDenenen: {', '.join(tried)}\n(path yanlis veya branch farklı olabilir)"
