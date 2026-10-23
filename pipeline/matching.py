"""Entity resolution: from a caption (or on-screen text) to an exact GitHub repository.

1. extract candidates: GitHub URLs, owner/repo, quoted/backticked/hashtag names, CamelCase or
   hyphenated tool names
2. resolve each against the catalog (exact → name match → GitHub search fallback)
3. score = 0.45 name similarity + 0.35 semantic similarity + 0.10 owner match + 0.10 popularity
4. accept ≥ 0.80, send 0.55–0.80 to the review queue, reject below
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field
from typing import Callable, Optional

from .config import MATCH_ACCEPT, MATCH_REVIEW
from .text import name_similarity, norm_name

URL = re.compile(r"github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)", re.I)
OWNER_REPO = re.compile(r"(?<![\w./@])([A-Za-z0-9][A-Za-z0-9-]{0,38})/([A-Za-z0-9_.-]{2,100})(?![\w/])")
QUOTED = re.compile(r"[`\"“”']([A-Za-z0-9][\w.-]{2,40})[`\"“”']")
HASHTAG = re.compile(r"#([A-Za-z][A-Za-z0-9_]{3,40})")
TOOLISH = re.compile(r"\b([A-Za-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+|[A-Za-z]+\d+[A-Za-z]*)\b")
STOP = {"github", "repo", "repository", "opensource", "open", "source", "ai", "aitools", "chatgpt", "claude", "coding", "python", "javascript",
        "programming", "developer", "tech", "free", "tools", "automation", "reels", "viral", "trending", "linkinbio", "follow", "comment",
        "machinelearning", "artificialintelligence", "llm", "gpt", "openai", "aiagent", "aiagents", "productivity", "software", "code"}


@dataclass
class Candidate:
    text: str
    kind: str  # url | owner_repo | quoted | hashtag | toolish
    owner: Optional[str] = None


@dataclass
class Match:
    full_name: str
    confidence: float
    method: str
    evidence: dict = field(default_factory=dict)

    @property
    def decision(self) -> str:
        return "accept" if self.confidence >= MATCH_ACCEPT else "review" if self.confidence >= MATCH_REVIEW else "reject"


def extract(text: str) -> list[Candidate]:
    """Candidates in priority order, de-duplicated by normalised name."""
    out: list[Candidate] = []
    seen: set[str] = set()

    def add(c: Candidate) -> None:
        key = (c.owner or "").lower() + "/" + norm_name(c.text)
        if norm_name(c.text) and key not in seen and norm_name(c.text) not in STOP:
            seen.add(key)
            out.append(c)

    t = text or ""
    for m in URL.finditer(t):
        add(Candidate(re.sub(r"\.git$", "", m.group(2)), "url", m.group(1)))
    for m in OWNER_REPO.finditer(t):
        if "." in m.group(1) or m.group(1).isdigit():
            continue
        add(Candidate(m.group(2), "owner_repo", m.group(1)))
    for m in QUOTED.finditer(t):
        add(Candidate(m.group(1), "quoted"))
    for m in HASHTAG.finditer(t):
        add(Candidate(m.group(1), "hashtag"))
    for m in TOOLISH.finditer(t):
        add(Candidate(m.group(1), "toolish"))
    return out


class Resolver:
    """Resolves candidates against a catalog: list of dicts with full_name and stars (and an index)."""

    def __init__(self, catalog: list[dict], semantic: Optional[Callable[[str, str], float]] = None,
                 fallback: Optional[Callable[[str], Optional[dict]]] = None):
        self.by_full = {r["full_name"].lower(): r for r in catalog}
        self.by_name: dict[str, list[dict]] = {}
        for r in catalog:
            self.by_name.setdefault(norm_name(r["full_name"].split("/")[1]), []).append(r)
        self.max_log_stars = max((math.log1p(r.get("stars", 0)) for r in catalog), default=1.0) or 1.0
        self.semantic = semantic
        self.fallback = fallback

    def _pop(self, r: dict) -> float:
        return math.log1p(r.get("stars", 0)) / self.max_log_stars

    def resolve(self, text: str) -> list[Match]:
        matches: dict[str, Match] = {}
        for c in extract(text):
            if c.owner:
                full = f"{c.owner}/{c.text}".lower()
                r = self.by_full.get(full)
                if r:
                    conf = 0.97 if c.kind == "url" else 0.92
                    matches[r["full_name"]] = Match(r["full_name"], conf, c.kind, {"candidate": f"{c.owner}/{c.text}"})
                    continue
                # OCR slips ("browser-ug" for "browser-use"): fuzzy-match within the same owner's repos.
                owned = [x for k, x in self.by_full.items() if k.startswith(c.owner.lower() + "/")]
                best = max(owned, key=lambda x: name_similarity(c.text, x["full_name"].split("/")[1]), default=None)
                if best:
                    ns = name_similarity(c.text, best["full_name"].split("/")[1])
                    if ns >= 0.45:
                        matches[best["full_name"]] = Match(best["full_name"], round(0.6 + 0.4 * ns, 3), f"{c.kind}_fuzzy", {"candidate": f"{c.owner}/{c.text}", "name_sim": round(ns, 3)})
                        continue
                if c.kind == "url":  # a URL is explicit even when the repo isn't in our catalog yet
                    matches[f"{c.owner}/{c.text}"] = Match(f"{c.owner}/{c.text}", 0.9, "url", {"candidate": f"{c.owner}/{c.text}", "in_catalog": False})
                    continue
            pool = self.by_name.get(norm_name(c.text), [])
            if not pool and self.fallback and c.kind in ("quoted", "hashtag", "toolish", "owner_repo"):
                hit = self.fallback(c.text)
                if hit and name_similarity(c.text, hit["full_name"].split("/")[1]) >= 0.6:
                    pool = [self.by_full.get(hit["full_name"].lower(), hit)]
            for r in pool:
                ns = name_similarity(c.text, r["full_name"].split("/")[1])
                sem = self.semantic(text, r["full_name"]) if self.semantic else 0.5
                owner = 1.0 if c.owner and c.owner.lower() == r["full_name"].split("/")[0].lower() else 0.0
                conf = 0.45 * ns + 0.35 * sem + 0.10 * owner + 0.10 * self._pop(r)
                if len(pool) > 1:  # ambiguous name: discount, prefer the popular, semantically closer one
                    conf -= 0.05
                prev = matches.get(r["full_name"])
                if not prev or conf > prev.confidence:
                    matches[r["full_name"]] = Match(r["full_name"], round(conf, 3), c.kind, {"candidate": c.text, "name_sim": round(ns, 3), "semantic": round(sem, 3)})
        return sorted(matches.values(), key=lambda m: -m.confidence)
