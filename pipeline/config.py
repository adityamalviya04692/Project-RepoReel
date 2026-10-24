"""Pipeline configuration: where data lives, what to discover, and scoring weights.

Weights here are the single source of truth: they are also published to the site
(ranking.json) so the browser ranks exactly the way the pipeline evaluates.
"""
from __future__ import annotations

import os
from datetime import date, timedelta
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CURATED = ROOT / "curated"
HISTORY = ROOT / "data" / "history"      # persisted between runs (committed)
BRONZE = ROOT / "data" / "bronze"        # raw API responses (ephemeral, uploaded as a CI artifact)
GOLD = ROOT / "web" / "public" / "data"  # what the site serves

GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN") or ""
EMBED_MODEL = "sentence-transformers/all-MiniLM-L6-v2"  # same model the browser uses (Xenova/all-MiniLM-L6-v2)

TODAY = date.today()
_d = lambda n: (TODAY - timedelta(days=n)).isoformat()  # noqa: E731

# Discovery: GitHub search queries per category. Each returns up to `pages` × 100 repos, most-starred first.
CATEGORIES: dict[str, dict] = {
    "agents": {"label": "AI agents", "queries": ["topic:ai-agents stars:>300", "topic:agents stars:>800", "autonomous agent in:description stars:>800"]},
    "mcp": {"label": "MCP servers", "queries": ["topic:mcp stars:>80", "topic:mcp-server stars:>40", '"model context protocol" in:readme stars:>150']},
    "claude": {"label": "Claude tools", "queries": ["claude in:name,description stars:>150", "topic:claude-code stars:>40", "topic:claude stars:>150"]},
    "job-search": {"label": "Job search", "queries": ["topic:job-search stars:>20", "job search in:description stars:>60", "linkedin jobs in:name,description stars:>40", "apply jobs in:description stars:>40", "resume in:name,description llm stars:>60"]},
    "scraping": {"label": "Web scraping", "queries": ["topic:web-scraping stars:>400", "topic:scraper stars:>800", "crawler llm in:description stars:>300"]},
    "browser": {"label": "Browser automation", "queries": ["topic:browser-automation stars:>150", "browser agent in:description stars:>300"]},
    "rag": {"label": "RAG & search", "queries": ["topic:rag stars:>300", '"retrieval augmented generation" in:description stars:>300']},
    "data": {"label": "Data engineering", "queries": ["topic:data-engineering stars:>400", "topic:etl stars:>400", "topic:data-pipeline stars:>300"]},
    "local-llm": {"label": "Local LLMs", "queries": ["topic:ollama stars:>300", "topic:local-llm stars:>200", "topic:llm stars:>4000"]},
    "coding": {"label": "Coding agents", "queries": ["coding agent in:description stars:>400", "topic:code-generation stars:>500"]},
    "voice": {"label": "Voice & speech", "queries": ["topic:text-to-speech stars:>800", "topic:speech-to-text stars:>600"]},
    "documents": {"label": "Documents & OCR", "queries": ["topic:ocr stars:>800", "pdf parsing in:description stars:>400", "topic:document-parsing stars:>200"]},
    "automation": {"label": "Workflow automation", "queries": ["topic:workflow-automation stars:>300", "topic:automation stars:>2000", "topic:no-code stars:>2000"]},
    "media": {"label": "Image & video AI", "queries": ["topic:stable-diffusion stars:>2000", "topic:video-generation stars:>300", "topic:image-generation stars:>1000"]},
    "bots": {"label": "Chat bots", "queries": ["whatsapp bot in:description stars:>300", "telegram bot ai in:description stars:>400", "discord bot ai in:description stars:>400"]},
    "rising": {"label": "Rising now", "queries": [f"created:>{_d(45)} stars:>150", f"created:>{_d(120)} stars:>600"]},
}
SEARCH_PAGES = 2            # 2 × 100 per query keeps us well inside search rate limits
HN_DAYS = 30                # Hacker News lookback for mentions
HN_MIN_POINTS_TO_ADD = 30   # an HN-only repo joins the catalog if a story about it scored at least this

# AI-tool compatibility and platform lexicons (shared with the browser's query parser).
AI_COMPAT = {
    "mcp": ["mcp", "model context protocol", "mcp-server", "mcp server"],
    "claude": ["claude", "anthropic", "claude code", "claude-code"],
    "openai": ["openai", "chatgpt", "gpt-4", "gpt-5", "gpt4", "codex"],
    "gemini": ["gemini", "google ai studio", "vertex ai"],
    "local": ["ollama", "llama.cpp", "lm studio", "vllm", "gguf"],
}

# Scoring weights (spec §9). Published to the site as ranking.json.
# Tuned by a sweep over the golden queries (MRR 0.29 → 0.42, hit@3 33% → 50%).
RANK_WEIGHTS = {"semantic": 0.36, "keyword": 0.10, "popularity": 0.28, "momentum": 0.08, "health": 0.06, "social": 0.05, "freshness": 0.03}
TRUST_WEIGHTS = {"accuracy": 0.35, "consistency": 0.25, "engagement": 0.20, "recency": 0.20}
CREATOR_MIN_FOLLOWERS = 50_000
CREATOR_TOP_FOLLOWERS = 100_000
CREATOR_MIN_POSTS_60D = 4
MATCH_ACCEPT = 0.80
MATCH_REVIEW = 0.55

# ---------- automated reel discovery (free tiers only) ----------
APIFY_TOKEN = os.environ.get("APIFY_TOKEN", "")
APIFY_MONTHLY_CAP_USD = float(os.environ.get("APIFY_MONTHLY_CAP_USD", "4.5"))  # free plan gives $5/month; stop before it
IG_USER_ID = os.environ.get("IG_USER_ID", "")            # your Instagram Professional account id (Graph API)
IG_ACCESS_TOKEN = os.environ.get("IG_ACCESS_TOKEN", "")  # long-lived token with instagram_basic, pages_read_engagement
GRAPH = "https://graph.facebook.com/v23.0"

# Discovery finds creators who post about repos; their feeds then supply most reels (higher precision
# per call than any hashtag). Generic tags (#automation, #aiagents) were dropped: mostly off-topic.
REEL_TOPICS = [
    {"q": "githubrepo", "kind": "hashtag"}, {"q": "githubprojects", "kind": "hashtag"}, {"q": "opensourcetools", "kind": "hashtag"},
    {"q": "github", "kind": "hashtag"}, {"q": "opensource", "kind": "hashtag"}, {"q": "claudecode", "kind": "hashtag"},
    {"q": "opensourceai", "kind": "hashtag"}, {"q": "github repo", "kind": "keyword"}, {"q": "open source github", "kind": "keyword"},
    {"q": "free github tool", "kind": "keyword"}, {"q": "github project", "kind": "keyword"},
]
TOPICS_PER_RUN = 2
PROFILE_LOOKUPS_PER_RUN = 8     # new creators' follower counts (Apify) when no Graph token

# Apify free plan: spread the remaining monthly credit evenly over the days left in the cycle.
APIFY_USD_PER_RESULT = 0.0027   # conservative per-result price for the Instagram actors on the free plan
APIFY_MAX_RESULTS_PER_RUN = 120
APIFY_TOPIC_SHARE = 0.4         # the rest goes to feeds of creators who already post about repos
APIFY_FEED_PER_CREATOR = 8      # newest reels per creator feed

# Graph API (free): Business Discovery pages through a creator's whole public history.
# A crawl spends Meta's hourly allowance (~200 calls per app user), pauses until the window refreshes and
# continues while CRAWL_MINUTES last; the nightly job crawls for hours. Without CRAWL_MINUTES a run makes
# at most GRAPH_CALLS_PER_RUN calls.
CRAWL_MINUTES = int(os.environ.get("CRAWL_MINUTES") or 0)
GRAPH_CALLS_PER_RUN = 160
GRAPH_PAUSE_SECONDS = 900
GRAPH_MEDIA_PAGE = 30
REEL_BACKFILL_DAYS: int | None = None  # None = a creator's whole public history
# Hashtag recent media = public posts from the last 24 hours. Meta allows 30 unique hashtags per 7 days.
GRAPH_HASHTAGS = ["githubrepo", "github", "opensource", "githubprojects", "opensourcetools", "claudecode", "opensourceai", "aitools", "pythonprojects", "developertools"]
GRAPH_HASHTAG_PAGES = 2

OCR_PER_RUN = 150               # reel covers read with Tesseract when the caption hides the repo name
REELS_PUBLISH_MAX = 12000       # reels in the first download (newest first); every reel is in the per-repo shards
REELS_PER_REPO_MAX = 6          # per repo in that first download
REELS_PER_REPO_SHARD = 60       # per repo in its shard
REMATCH_DAYS = 7                # unmatched reels are matched again after this (the catalog keeps growing)
