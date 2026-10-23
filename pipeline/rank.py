"""Query understanding + hybrid ranking. The browser (web/src/lib/rank.ts) implements the same
logic with the same weights and lexicons (published as ranking.json); this copy powers evaluation."""
from __future__ import annotations

import math
import re
from collections import Counter
from typing import Optional

import numpy as np

from .config import AI_COMPAT, CATEGORIES, RANK_WEIGHTS

PLATFORMS = {
    "linkedin": ["linkedin"], "naukri": ["naukri"], "indeed": ["indeed"], "glassdoor": ["glassdoor"], "whatsapp": ["whatsapp"],
    "telegram": ["telegram"], "discord": ["discord"], "slack": ["slack"], "notion": ["notion"], "gmail": ["gmail", "email"],
    "youtube": ["youtube"], "instagram": ["instagram"], "twitter": ["twitter", "x.com"], "reddit": ["reddit"], "github": ["github"],
    "excel": ["excel", "spreadsheet", "google sheets"], "pdf": ["pdf"],
}
LANGUAGES = {"python": "Python", "typescript": "TypeScript", "javascript": "JavaScript", "go": "Go", "golang": "Go", "rust": "Rust", "java": "Java", "c++": "C++", "swift": "Swift", "kotlin": "Kotlin"}
CATEGORY_WORDS = {
    "job-search": ["job", "jobs", "hiring", "apply", "resume", "cv", "career", "interview"],
    "scraping": ["scrape", "scraper", "scraping", "crawl", "crawler", "extract data"],
    "browser": ["browser", "web automation", "click", "fill forms", "playwright", "selenium"],
    "rag": ["rag", "documents", "knowledge base", "chat with", "retrieval", "search my"],
    "mcp": ["mcp", "model context protocol"],
    "agents": ["agent", "autonomous", "multi-agent"],
    "coding": ["code", "coding", "developer", "pull request", "refactor"],
    "voice": ["voice", "speech", "tts", "transcribe", "podcast", "audio"],
    "documents": ["ocr", "pdf", "invoice", "receipt", "document"],
    "automation": ["automate", "automation", "workflow", "zapier", "n8n"],
    "media": ["image", "video", "photo", "thumbnail", "diffusion", "generate images"],
    "bots": ["bot", "chatbot", "whatsapp", "telegram", "discord"],
    "data": ["etl", "pipeline", "data engineering", "warehouse", "dbt", "spark"],
    "local-llm": ["local", "offline", "on my laptop", "ollama", "self-hosted", "private"],
}
STOPWORDS = set("a an the i me my we our for to of in on with and or that which who want need looking something tool tools repo repos github app that can help me find please some any using use".split())
TOKEN = re.compile(r"[a-z0-9][a-z0-9+#.-]*")


def tokens(text: str) -> list[str]:
    out = []
    for t in TOKEN.findall(text.lower()):
        t = t.strip(".-")
        if len(t) > 4:
            t = re.sub(r"(ing|ers|er|es|s)$", "", t)
        elif len(t) == 4 and t.endswith("s") and not t.endswith("ss"):
            t = t[:-1]
        if t and t not in STOPWORDS:
            out.append(t)
    return out


def understand(q: str) -> dict:
    """Facets from a natural-language need: AI tool, platforms, language, location, categories."""
    ql = q.lower()
    facets = {
        "ai": [k for k, ws in AI_COMPAT.items() if any(re.search(rf"\b{re.escape(w)}\b", ql) for w in ws)],
        "platforms": [k for k, ws in PLATFORMS.items() if any(re.search(rf"\b{re.escape(w)}\b", ql) for w in ws)],
        "language": next((v for k, v in LANGUAGES.items() if re.search(rf"\b{re.escape(k)}\b", ql)), None),
        "location": None,
        "categories": [c for c, ws in CATEGORY_WORDS.items() if any(re.search(rf"\b{re.escape(w)}", ql) for w in ws)],
    }
    m = re.search(r"\b(?:in|at|near|around|based in)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)", q)
    if m and m.group(1).lower() not in {"python", "go", "rust", "java", "excel", "notion", "slack"}:
        facets["location"] = m.group(1)
    return facets


class BM25:
    def __init__(self, docs: list[list[str]], k1: float = 1.2, b: float = 0.75):
        self.docs = [Counter(d) for d in docs]
        self.len = [len(d) for d in docs]
        self.avg = sum(self.len) / max(1, len(self.len))
        df = Counter(t for d in self.docs for t in d)
        n = len(docs)
        self.idf = {t: math.log(1 + (n - f + 0.5) / (f + 0.5)) for t, f in df.items()}
        self.k1, self.b = k1, b

    def scores(self, q: list[str]) -> np.ndarray:
        out = np.zeros(len(self.docs), dtype=np.float32)
        for i, d in enumerate(self.docs):
            s = 0.0
            for t in q:
                f = d.get(t)
                if f:
                    s += self.idf[t] * f * (self.k1 + 1) / (f + self.k1 * (1 - self.b + self.b * self.len[i] / self.avg))
            out[i] = s
        return out


def search_text(r: dict) -> str:
    owner, name = r["full_name"].split("/", 1)
    return f"{name.replace('-', ' ').replace('_', ' ')} {name} {owner} {r.get('description', '')} {' '.join(r.get('topics', []))} {r.get('excerpt', '')}"


def rank(query: str, qvec: Optional[np.ndarray], repos: list[dict], vecs: Optional[np.ndarray], bm25: BM25, k: int = 10) -> list[tuple[int, float]]:
    f = understand(query)
    # Without a query vector, keywords carry the semantic weight (the browser does the same while its model loads).
    w = RANK_WEIGHTS if qvec is not None else {**RANK_WEIGHTS, "keyword": RANK_WEIGHTS["keyword"] + RANK_WEIGHTS["semantic"], "semantic": 0.0}
    kw = bm25.scores(tokens(query + " " + " ".join(f["categories"])))
    kw = kw / kw.max() if kw.max() > 0 else kw
    sem = (vecs @ qvec).astype(np.float32) if (qvec is not None and vecs is not None) else np.zeros(len(repos), np.float32)
    sem = np.clip((sem - 0.15) / 0.55, 0, 1)  # MiniLM cosine: ~0.15 unrelated, ~0.7 near-identical
    max_log = max(math.log1p(r["stars"]) for r in repos) or 1.0
    out = []
    for i, r in enumerate(repos):
        pop = math.log1p(r["stars"]) / max_log  # canonical, widely used repos get a modest lift
        s = (w["semantic"] * sem[i] + w["keyword"] * kw[i] + w["popularity"] * pop + w["momentum"] * r["sc"]["momentum"]
             + w["health"] * r["sc"]["health"] + w["social"] * r["sc"]["social"] + w["freshness"] * r["sc"]["fresh"])
        if f["ai"]:
            s += 0.06 if set(f["ai"]) & set(r.get("ai", [])) else -0.04
        if f["language"] and r.get("language") == f["language"]:
            s += 0.03
        if f["categories"] and set(f["categories"]) & set(r.get("cat", [])):
            s += 0.03
        if r.get("archived"):
            s -= 0.2
        out.append((i, float(s)))
    out.sort(key=lambda x: -x[1])
    return out[:k]
