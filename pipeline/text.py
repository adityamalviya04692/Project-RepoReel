"""Text helpers shared by the pipeline: README cleaning, tokenising, fuzzy name similarity."""
from __future__ import annotations

import re

_IMG = re.compile(r"!\[[^\]]*\]\([^)]*\)")
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_HTML = re.compile(r"<[^>]+>")
_CODE = re.compile(r"```.*?```", re.S)
_HEAD = re.compile(r"^#+\s*", re.M)
_WS = re.compile(r"\s+")
_BADGE = re.compile(r"\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)")  # [![alt](img)](link)


def clean_readme(md: str, limit: int = 1500) -> str:
    """Readable prose from a README: no badges, images, HTML, code blocks or link targets."""
    t = _CODE.sub(" ", md or "")
    t = _BADGE.sub(" ", t)
    t = _IMG.sub(" ", t)
    t = _LINK.sub(r"\1", t)
    t = _HTML.sub(" ", t)
    t = _HEAD.sub("", t)
    t = re.sub(r"[*_`>|#=~-]{2,}", " ", t)
    return _WS.sub(" ", t).strip()[:limit]


def norm_name(s: str) -> str:
    """Repo-name normal form: lowercase, separators removed (browser_use == Browser-Use == browseruse)."""
    return re.sub(r"[^a-z0-9]", "", s.lower())


def trigrams(s: str) -> set:
    s = f"  {norm_name(s)} "
    return {s[i : i + 3] for i in range(len(s) - 2)}


def name_similarity(a: str, b: str) -> float:
    """Trigram Jaccard on normalised names (1.0 = same name)."""
    if norm_name(a) == norm_name(b):
        return 1.0
    ta, tb = trigrams(a), trigrams(b)
    return len(ta & tb) / max(1, len(ta | tb))


def shard_key(name: str) -> str:
    """Which per-repo reel shard a repository lives in: FNV-1a over the lowercased name, 256 buckets.
    web/src/lib/data.ts computes the same key."""
    h = 0x811C9DC5
    for b in name.lower().encode():
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return f"{h & 0xFF:02x}"
