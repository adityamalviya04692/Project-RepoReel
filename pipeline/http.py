"""HTTP helpers: one client, retries with backoff, and GitHub rate-limit awareness."""
from __future__ import annotations

import time
from typing import Any, Optional

import httpx

from .config import GITHUB_TOKEN

_client: Optional[httpx.Client] = None


def client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=40, headers={"User-Agent": "RepoReel-pipeline (+https://github.com/adityamalviya04692/Project-RepoReel)"})
    return _client


def gh_headers() -> dict[str, str]:
    h = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return h


def request(method: str, url: str, *, retries: int = 4, **kw: Any) -> httpx.Response:
    """Retries on 5xx / network errors; waits out GitHub secondary and primary rate limits."""
    for attempt in range(retries + 1):
        try:
            r = client().request(method, url, **kw)
        except httpx.HTTPError:
            if attempt == retries:
                raise
            time.sleep(2 ** attempt)
            continue
        if r.status_code in (403, 429) and ("rate limit" in r.text.lower() or r.headers.get("retry-after")):
            reset = r.headers.get("x-ratelimit-reset")
            wait = int(r.headers.get("retry-after") or 0) or (max(5, int(reset) - int(time.time()) + 2) if reset else 30)
            if attempt == retries or wait > 900:
                r.raise_for_status()
            time.sleep(min(wait, 120))
            continue
        if r.status_code >= 500 and attempt < retries:
            time.sleep(2 ** attempt)
            continue
        return r
    return r
