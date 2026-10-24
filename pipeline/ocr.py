"""On-screen text from a reel's cover image (Tesseract), for "comment REPO" reels whose caption hides the
repo name but whose cover shows it. Optional: without the tesseract binary every call returns ""."""
from __future__ import annotations

import shutil
import subprocess
from urllib.parse import urlparse

import httpx

from .http import request

CDN_HOSTS = ("cdninstagram.com", "fbcdn.net")  # cover URLs come from the API responses; nothing else is fetched
MAX_BYTES = 6_000_000


def available() -> bool:
    return shutil.which("tesseract") is not None


def read(url: str) -> str:
    host = urlparse(url or "").hostname or ""
    if not available() or not host.endswith(CDN_HOSTS):
        return ""
    try:
        r = request("GET", url, retries=1, timeout=20)
    except httpx.HTTPError:
        return ""
    if r.status_code != 200 or not r.headers.get("content-type", "").startswith("image/") or len(r.content) > MAX_BYTES:
        return ""
    try:
        p = subprocess.run(["tesseract", "stdin", "stdout", "--psm", "11"], input=r.content, capture_output=True, timeout=40)
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return " ".join(p.stdout.decode(errors="ignore").split())[:600]
