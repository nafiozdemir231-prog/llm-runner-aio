"""
mcp_web_reader.py — OpenCode / MCP icin web arama + sayfa okuma sunucusu
------------------------------------------------------------------------
Bu sunucu `websearchtool.py` motorunu (Open WebUI araciyla BIREBIR ayni) FastMCP
uzerinden acar. Tek kaynak kodu, iki arayuz: Open WebUI Tools + MCP server.

Kurulum:
  pip install "mcp>=1.2" scrapling trafilatura beautifulsoup4 requests pydantic
  python -m playwright install chromium      # bot/Cloudflare korumali siteler icin

opencode.json (proje root dizininden):
  "mcp": {
    "web-reader": {
      "type": "local",
      "command": ["python", "./mcp_web_reader.py"],
      "enabled": true
    }
  }

Ortam degiskenleri (hepsi opsiyonel):
  SEARXNG_URL              bos ise sabit http://localhost:8080
  GITHUB_TOKEN             GitHub rate limit + code aramasi
  MCP_MAX_CHARS            read_url karakter limiti          (varsayilan 6000)
  MCP_MAX_RESULTS          arama sonuc sayisi                (varsayilan 5)
  MCP_READ_COUNT           search_and_read tam okuma sayisi  (varsayilan 3)
  MCP_ENABLE_STEALTH       0/1 browser katmani               (varsayilan 1)
  MCP_ALLOW_PRIVATE_URLS   0/1 yerel/ozel IP okuma izni      (varsayilan 0 -> kapali)
  MCP_CACHE_TTL            cache dakikasi                    (varsayilan 90)
  MCP_BLOCKED_DOMAINS      virgülle ayrik karaliste
  MCP_DEBUG                0/1 log (loglar STDERR'e gider, stdout protokol icin temiz)
  ADVISOR_API_KEY          advisor anahtari (bos ise dosyadaki ADVISOR_KEY kullanilir)
  ADVISOR_MODEL            bos ise dosyadaki ADVISOR_MODEL (z-ai/glm-5.2)
  ADVISOR_URL              bos ise dosyadaki ADVISOR_URL (openrouter)
"""

# NOT: `from __future__ import annotations` KULLANILMAZ.
# Bu mcp surumu FastMCP icin gercek tip nesnelerini ister (issubclass kontrolu); string
# anotasyonlar "issubclass() arg 1 must be a class" hatasi veriyor.
import asyncio
import functools
import os
import sys
from pathlib import Path
from typing import Any, Optional

from mcp.server.fastmcp import FastMCP

# websearchtool.py ayni dizinde olmali
sys.path.insert(0, str(Path(__file__).resolve().parent))

mcp = FastMCP("web-reader")


def _env_flag(name: str, default: bool) -> bool:
    raw = os.environ.get(name, "").strip().lower()
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    return default


def _env_int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, "").strip() or default)
    except ValueError:
        return default


# ---------------------------------------------------------------------------
# SearXNG adresi: sabit (bu sunucunun calistigi makinede SearXNG localhost'ta)
# ---------------------------------------------------------------------------
SEARXNG_URL = "http://localhost:8080"


# ---------------------------------------------------------------------------
# Motor yukleniyor (websearchtool.py)
# ---------------------------------------------------------------------------
ENGINE_ERROR = ""
ENGINE = None

try:
    import websearchtool  # noqa: E402

    # ONEMLI: stdio MCP'de stdout JSON-RPC'ye ayrilmis. Motorun loglarini STDERR'e yonlendiriyoruz.
    def _log_to_stderr(enabled: bool, message: str) -> None:
        if enabled:
            print(f"[web-reader] {message}", file=sys.stderr, flush=True)

    websearchtool._log = _log_to_stderr

    ENGINE = websearchtool.Tools()
    valves = ENGINE.valves
    valves.searxng_url = os.environ.get("SEARXNG_URL") or SEARXNG_URL
    valves.github_token = os.environ.get("GITHUB_TOKEN", valves.github_token)
    valves.max_chars_per_page = _env_int("MCP_MAX_CHARS", valves.max_chars_per_page)
    valves.max_results = _env_int("MCP_MAX_RESULTS", valves.max_results)
    valves.read_count = _env_int("MCP_READ_COUNT", valves.read_count)
    valves.enable_stealth_browser = _env_flag("MCP_ENABLE_STEALTH", valves.enable_stealth_browser)
    valves.allow_private_urls = _env_flag("MCP_ALLOW_PRIVATE_URLS", valves.allow_private_urls)
    valves.cache_ttl_minutes = _env_int("MCP_CACHE_TTL", valves.cache_ttl_minutes)
    valves.blocked_domains = os.environ.get("MCP_BLOCKED_DOMAINS", valves.blocked_domains)
    valves.default_categories = os.environ.get("MCP_CATEGORIES", valves.default_categories)
    valves.debug_logging = _env_flag("MCP_DEBUG", True)
except Exception as exc:  # motor yoksa her arac net hata doner
    ENGINE_ERROR = f"websearchtool.py yuklenemedi ({exc}). Bu dosya ile ayni dizinde olmali."


def _engine_or_error() -> Optional[Any]:
    return None if ENGINE is None else ENGINE


async def _to_thread(fn, *args, **kwargs):
    """Bloklayan cagrilari MCP event loop'ini kilitlemeden calistirir."""
    part = functools.partial(fn, *args, **kwargs)
    try:
        import anyio

        return await anyio.to_thread.run_sync(part)
    except ImportError:
        return await asyncio.to_thread(part)


# ---------------------------------------------------------------------------
# MCP araclari
# ---------------------------------------------------------------------------
@mcp.tool()
async def get_current_time(timezone_name: str = "local") -> str:
    """
    Current date/time in UTC, local and an optional IANA timezone.
    Use this before answering anything that depends on 'today' or 'latest'.
    Args:
        timezone_name: 'local' or an IANA name such as Europe/Istanbul, UTC.
    """
    engine = _engine_or_error()
    if not engine:
        return ENGINE_ERROR
    return await engine.get_current_time(timezone_name=timezone_name)


@mcp.tool()
async def search_web(
    query: str,
    count: int = 5,
    category: str = "",
    time_range: str = "",
    language: str = "",
) -> str:
    """
    Fast web search that returns titles, URLs and snippets WITHOUT reading pages.
    Use it to discover sources, then read_url / read_urls on the promising links.
    Args:
        query: Search query. Operators work: site:github.com, "exact phrase", -exclude.
        count: Number of results (1-10).
        category: SearXNG category; comma separated works too, e.g. 'general,it' for technical topics, 'news' for current events.
        time_range: day, week, month or year (empty = all time).
        language: Language code such as tr, en, de (empty = server default).
    """
    engine = _engine_or_error()
    if not engine:
        return ENGINE_ERROR
    return await engine.search_web(
        query=query,
        max_results=count,
        category=category,
        time_range=time_range,
        language=language,
    )


@mcp.tool()
async def search_and_read(
    query: str,
    max_results: int = 3,
    category: str = "",
    time_range: str = "",
    language: str = "",
) -> str:
    """
    Search the web and read the FULL content of the top result pages in one call.
    Use for factual/current/technical questions that need real page text.
    Args:
        query: Search query. Add site:/-exclude/"exact" to sharpen results.
        max_results: How many pages to fetch fully (1-6).
        category: SearXNG category; 'general,it' widens technical searches, 'news' for news.
        time_range: day, week, month or year (empty = all time).
        language: Language code such as tr, en, de (empty = server default).
    """
    engine = _engine_or_error()
    if not engine:
        return ENGINE_ERROR
    return await engine.search_and_read(
        query=query,
        max_results=max_results,
        category=category,
        time_range=time_range,
        language=language,
    )


@mcp.tool()
async def read_url(url: str, max_chars: int = 0) -> str:
    """
    Read the clean text of one web page. Handles Cloudflare/JS protected pages
    (headless browser fallback), strips boilerplate and converts GitHub blob URLs to raw.
    Args:
        url: Absolute http/https page URL.
        max_chars: Character limit for this call (0 = server default).
    """
    engine = _engine_or_error()
    if not engine:
        return ENGINE_ERROR
    return await engine.read_url(url=url, max_chars=max_chars)


@mcp.tool()
async def read_urls(urls: list[str], max_chars_per_page: int = 0) -> str:
    """
    Read several pages in parallel (max 8) and return their text in one call.
    Prefer this over repeated read_url calls when the URLs are already known.
    Args:
        urls: List of absolute page URLs.
        max_chars_per_page: Character limit per page (0 = server default).
    """
    engine = _engine_or_error()
    if not engine:
        return ENGINE_ERROR
    return await engine.read_urls(urls=urls, max_chars_per_page=max_chars_per_page)


@mcp.tool()
async def list_links(url: str, contains: str = "", max_links: int = 40) -> str:
    """
    List the links found on a page - useful to navigate docs sites and find the exact page to read.
    Args:
        url: Page URL whose links will be listed.
        contains: Keep only links containing this text (case-insensitive), e.g. 'install' or 'tag'.
        max_links: Maximum links to return (1-100).
    """
    engine = _engine_or_error()
    if not engine:
        return ENGINE_ERROR
    return await engine.list_links(url=url, contains=contains, max_links=max_links)


@mcp.tool()
async def read_github_file(repo: str, file_path: str = "", branch: str = "") -> str:
    """
    Read a file from a GitHub repo, or list the repo/directory tree when file_path is empty.
    Default branch is resolved automatically and main/master fallbacks are tried.
    Args:
        repo: 'owner/repo' or a full GitHub URL. Example: theroyallab/tabbyAPI
        file_path: File or directory path (README.md, src/main.py, docs/). Empty = list the tree.
        branch: Branch name (empty = repo default branch).
    """
    engine = _engine_or_error()
    if not engine:
        return ENGINE_ERROR
    return await engine.read_github_repo(repo=repo, path=file_path, branch=branch)


@mcp.tool()
async def github_search(
    query: str,
    search_type: str = "repositories",
    max_results: int = 8,
    language: str = "",
) -> str:
    """
    Search GitHub for repositories or topics (code search requires GITHUB_TOKEN).
    Args:
        query: Search terms; GitHub qualifiers work too, e.g. 'scrapling stars:>500'.
        search_type: repositories, topics or code.
        max_results: Items to return (1-20).
        language: Optional repository language filter.
    """
    engine = _engine_or_error()
    if not engine:
        return ENGINE_ERROR
    return await engine.github_search(
        query=query, search_type=search_type, max_results=max_results, language=language
    )


# ---------------------------------------------------------------------------
# Advisor (eski yapilandirmasiyla; istenirse ortam degiskeni ile asilir)
# ---------------------------------------------------------------------------
ADVISOR_URL = "https://openrouter.ai/api/v1"
ADVISOR_KEY = "22222"
ADVISOR_MODEL = "z-ai/glm-5.2"


def _advisor_post(question: str, context: str) -> str:
    import requests

    api_key = os.environ.get("ADVISOR_API_KEY") or ADVISOR_KEY
    advisor_url = os.environ.get("ADVISOR_URL") or ADVISOR_URL
    advisor_model = os.environ.get("ADVISOR_MODEL") or ADVISOR_MODEL

    messages = []
    if context:
        messages.append({"role": "user", "content": f"Context:\n{context}\n\nQuestion:\n{question}"})
    else:
        messages.append({"role": "user", "content": question})

    try:
        resp = requests.post(
            f"{advisor_url}/chat/completions",
            headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
            json={"model": advisor_model, "messages": messages, "stream": False},
            timeout=60,
        )
    except Exception as exc:
        err = f"[ask_advisor] Hata: {exc}"
        print(err, file=sys.stderr, flush=True)
        return err

    if resp.status_code == 200:
        data = resp.json()
        answer = data["choices"][0]["message"]["content"]
        print(f"[ask_advisor] Cevap alindi: {len(answer)} karakter", file=sys.stderr, flush=True)
        return answer

    err = f"[ask_advisor] HTTP {resp.status_code}: {resp.text[:300]}"
    print(err, file=sys.stderr, flush=True)
    return err


@mcp.tool()
async def ask_advisor(question: str, context: str = "") -> str:
    """
    Ask a more powerful advisor model when you are stuck or unsure.
    Use this when you cannot solve a problem, need a second opinion, or require deeper reasoning.
    Args:
        question: The specific question or problem you are stuck on.
        context: Optional. Leave empty if not needed. Always provide at least an empty string.
    Returns the advisor's answer as a string to continue your work.
    """
    return await _to_thread(_advisor_post, question, context)


if __name__ == "__main__":
    if ENGINE_ERROR:
        print(f"[web-reader] {ENGINE_ERROR}", file=sys.stderr, flush=True)
    mcp.run(transport="stdio")
