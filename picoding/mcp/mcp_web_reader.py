"""
mcp_web_reader.py — OpenCode için Scrapling Web Okuyucu MCP Server
------------------------------------------------------------------
Kurulum:
  pip install mcp scrapling trafilatura beautifulsoup4 requests
  scrapling install

opencode.json'a ekle:
  "mcp": {
    "web-reader": {
      "type": "local",
      "command": ["python", "D:/Programlar/OpenCode/mcp_web_reader.py"],
      "enabled": true
    }
  }
"""

import sys
import requests
from mcp.server.fastmcp import FastMCP

mcp = FastMCP("web-reader")


def _fetch(url: str, max_chars: int = 6000) -> str:
    """
    Katmanlı web okuyucu:
    1. Scrapling StealthyFetcher (Cloudflare, JS destekli)
    2. Scrapling Fetcher (hızlı)
    3. Trafilatura (yedek)
    4. BeautifulSoup (son çare)
    """
    # GitHub blob → raw dönüşümü
    if "github.com" in url and "/blob/" in url:
        url = url.replace("https://github.com", "https://raw.githubusercontent.com")
        url = url.replace("/blob/", "/")
        print(f"[web-reader] GitHub raw URL: {url}", file=sys.stderr)

    # 1. Scrapling StealthyFetcher
    try:
        from scrapling.fetchers import StealthyFetcher
        page = StealthyFetcher.fetch(url, headless=True, network_idle=True, timeout=20000)
        if page and page.status == 200:
            text = page.get_all_text(ignore_tags=('script', 'style', 'nav', 'footer', 'header'))
            text = ' '.join(text.split())
            if len(text) > 200:
                print(f"[web-reader] StealthyFetcher: {len(text)} karakter", file=sys.stderr)
                return text[:max_chars]
    except Exception as e:
        print(f"[web-reader] StealthyFetcher hatasi: {e}", file=sys.stderr)

    # 2. Scrapling Fetcher
    try:
        from scrapling.fetchers import Fetcher
        page = Fetcher.get(url, timeout=15)
        if page and page.status == 200:
            text = page.get_all_text(ignore_tags=('script', 'style', 'nav', 'footer', 'header'))
            text = ' '.join(text.split())
            if len(text) > 200:
                print(f"[web-reader] Fetcher: {len(text)} karakter", file=sys.stderr)
                return text[:max_chars]
    except Exception as e:
        print(f"[web-reader] Fetcher hatasi: {e}", file=sys.stderr)

    # 3. Trafilatura
    try:
        import trafilatura
        downloaded = trafilatura.fetch_url(url)
        text = trafilatura.extract(downloaded, include_links=False, include_images=False)
        if text and len(text) > 200:
            print(f"[web-reader] Trafilatura: {len(text)} karakter", file=sys.stderr)
            return text[:max_chars]
    except Exception as e:
        print(f"[web-reader] Trafilatura hatasi: {e}", file=sys.stderr)

    # 4. BeautifulSoup
    try:
        from bs4 import BeautifulSoup
        headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}
        resp = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
        for tag in soup(['script', 'style', 'nav', 'footer', 'header']):
            tag.decompose()
        text = ' '.join(soup.get_text().split())
        if len(text) > 200:
            print(f"[web-reader] BeautifulSoup: {len(text)} karakter", file=sys.stderr)
            return text[:max_chars]
    except Exception as e:
        print(f"[web-reader] BeautifulSoup hatasi: {e}", file=sys.stderr)

    return f"Sayfa okunamadi: {url}"


@mcp.tool()
def read_url(url: str) -> str:
    """
    Read the full content of any URL.
    Supports Cloudflare-protected sites, JavaScript-heavy pages, and GitHub files.
    Automatically converts GitHub blob URLs to raw for better reading.
    Use this when you need to read documentation, GitHub repos, articles, or any web page.
    """
    return _fetch(url, max_chars=6000)


@mcp.tool()
def read_github_file(repo: str, file_path: str = "README.md", branch: str = "main") -> str:
    """
    Read a specific file from a GitHub repository directly.
    Args:
        repo: GitHub repo in 'owner/repo' format. Example: theroyallab/tabbyAPI
        file_path: File path in the repo. Example: README.md or docs/install.md
        branch: Branch name, default is main
    Use this when you need to read source code, documentation, or config files from GitHub.
    """
    raw_url = f"https://raw.githubusercontent.com/{repo}/{branch}/{file_path}"
    try:
        headers = {'User-Agent': 'Mozilla/5.0'}
        resp = requests.get(raw_url, headers=headers, timeout=15)
        if resp.status_code == 200:
            return resp.text[:8000]
        # main çalışmazsa master dene
        if branch == "main":
            raw_url = f"https://raw.githubusercontent.com/{repo}/master/{file_path}"
            resp = requests.get(raw_url, headers=headers, timeout=15)
            if resp.status_code == 200:
                return resp.text[:8000]
        return f"Dosya bulunamadi: {repo}/{file_path}"
    except Exception as e:
        return f"GitHub okuma hatasi: {e}"


@mcp.tool()
def search_web(query: str, count: int = 3) -> str:
    """
    Search the web using SearXNG and read full content of each result.
    Args:
        query: Search query
        count: Number of results to return (default 3, max 5)
    Use this for current information, news, documentation, or any real-time data.
    """
    try:
        search_url = "http://localhost:8080/search"
        params = {"q": query, "format": "json", "count": min(count, 5)}
        resp = requests.get(search_url, params=params, timeout=8)
        results = resp.json().get("results", [])[:count]
    except Exception as e:
        return f"Arama hatasi: {e}"

    if not results:
        return "Sonuç bulunamadı."

    output = []
    for r in results:
        title = r.get("title", "")
        url   = r.get("url", "")
        text  = _fetch(url, max_chars=2000)
        if "okunamadi" in text:
            text = r.get("content", "İçerik alınamadı")
        output.append(f"## {title}\n{url}\n\n{text}")

    return "\n\n---\n\n".join(output)

ADVISOR_URL = "https://openrouter.ai/api/v1"
ADVISOR_KEY = "22222"
ADVISOR_MODEL = "z-ai/glm-5.2"


@mcp.tool()
def ask_advisor(question: str, context: str = "") -> str:
    """
    Ask a more powerful advisor model when you are stuck or unsure.
    Use this when you cannot solve a problem, need a second opinion, or require deeper reasoning.
    Args:
        question: The specific question or problem you are stuck on.
        context: Optional. Leave empty if not needed. Always provide at least an empty string.
    Returns the advisor's answer as a string to continue your work.
    """
    messages = []
    if context:
        messages.append({
            "role": "user",
            "content": f"Context:\n{context}\n\nQuestion:\n{question}"
        })
    else:
        messages.append({
            "role": "user",
            "content": question
        })

    try:
        resp = requests.post(
            ADVISOR_URL,
            headers={
                "Authorization": f"Bearer {ADVISOR_KEY}",
                "Content-Type": "application/json"
            },
            json={
                "model": ADVISOR_MODEL,
                "messages": messages,
                "stream": False
            },
            timeout=60
        )
        if resp.status_code == 200:
            data = resp.json()
            answer = data["choices"][0]["message"]["content"]
            print(f"[ask_advisor] Cevap alindi: {len(answer)} karakter", file=sys.stderr)
            return answer
        else:
            err = f"[ask_advisor] HTTP {resp.status_code}: {resp.text[:300]}"
            print(err, file=sys.stderr)
            return err
    except Exception as e:
        err = f"[ask_advisor] Hata: {e}"
        print(err, file=sys.stderr)
        return err

if __name__ == "__main__":
    mcp.run(transport="stdio")
