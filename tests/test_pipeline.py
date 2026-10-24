from datetime import date

import pytest
from pydantic import ValidationError

from pipeline import quality
from pipeline.matching import Resolver, extract
from pipeline.rank import BM25, tokens, understand
from pipeline.scoring import ai_compat, creator_trust, health, momentum, momentum_score
from pipeline.sources.curated import Creator, Reel
from pipeline.sources.hn import repo_from_url
from pipeline.text import clean_readme, name_similarity

CATALOG = [
    {"full_name": "browser-use/browser-use", "stars": 70000},
    {"full_name": "unclecode/crawl4ai", "stars": 50000},
    {"full_name": "speedyapply/JobSpy", "stars": 2500},
    {"full_name": "someone/jobspy-ui", "stars": 40},
]


# ---------- extraction & matching ----------
def test_extract_finds_urls_owner_repo_and_tool_names():
    text = "This repo is insane 🔥 github.com/unclecode/crawl4ai — also try `browser-use` and speedyapply/JobSpy #LangGraph #ai"
    kinds = {(c.kind, c.text) for c in extract(text)}
    assert ("url", "crawl4ai") in kinds
    assert ("owner_repo", "JobSpy") in kinds
    assert ("quoted", "browser-use") in kinds
    assert ("hashtag", "LangGraph") in kinds
    assert not any(c.text.lower() == "ai" for c in extract(text))  # generic hashtags are ignored


def test_resolver_prefers_explicit_references():
    r = Resolver(CATALOG)
    m = r.resolve("Check github.com/unclecode/crawl4ai for LLM-ready scraping")[0]
    assert (m.full_name, m.method, m.decision) == ("unclecode/crawl4ai", "url", "accept")
    m = r.resolve("speedyapply/JobSpy scrapes LinkedIn, Indeed and Glassdoor")[0]
    assert m.full_name == "speedyapply/JobSpy" and m.confidence >= 0.9


def test_resolver_name_only_uses_similarity_and_popularity():
    r = Resolver(CATALOG, semantic=lambda text, full: 0.9 if "browser" in full else 0.2)
    m = r.resolve("Let AI control your browser with Browser Use (browser_use) 🤯")[0]
    assert m.full_name == "browser-use/browser-use"
    assert m.decision in ("accept", "review")


def test_ocr_slip_in_url_is_fuzzy_matched_within_owner():
    m = Resolver(CATALOG).resolve("github.com/browser-use/browser-ug")[0]
    assert m.full_name == "browser-use/browser-use" and m.method == "url_fuzzy" and m.confidence >= 0.8


def test_unknown_url_is_kept_with_flag():
    m = Resolver(CATALOG).resolve("https://github.com/newcomer/fresh-tool")[0]
    assert m.full_name == "newcomer/fresh-tool" and m.evidence["in_catalog"] is False


def test_name_similarity():
    assert name_similarity("browser_use", "Browser-Use") == 1.0
    assert name_similarity("crawl4ai", "crawl4ai-ui") > 0.5
    assert name_similarity("crawl4ai", "langchain") < 0.2


def test_hn_repo_url_parsing():
    assert repo_from_url("https://github.com/ollama/ollama.git") == "ollama/ollama"
    assert repo_from_url("https://github.com/orgs/foo/people") is None
    assert repo_from_url("https://example.com") is None


# ---------- curated validation ----------
def test_curated_validation():
    assert Creator(handle="@Some.Creator", followers=120000).handle == "some.creator"
    with pytest.raises(ValidationError):
        Creator(handle="bad handle!", followers=10)
    r = Reel(url="https://www.instagram.com/reel/ABC123xyz/?igsh=1", creator="@X", posted="2026-10-01", repo="https://github.com/a/b")
    assert r.url == "https://www.instagram.com/reel/ABC123xyz/" and r.repo == "a/b" and r.creator == "x"
    with pytest.raises(ValidationError):
        Reel(url="https://youtube.com/shorts/x", creator="x", posted="2026-10-01")


# ---------- scoring ----------
TODAY = date(2026, 10, 23)


def test_health_rewards_active_licensed_repos():
    good = {"pushed_at": "2026-10-20T00:00:00Z", "license": "MIT", "latest_release": "2026-09-01T00:00:00Z", "readme": "x" * 4000}
    stale = {"pushed_at": "2024-01-01T00:00:00Z", "license": "", "latest_release": "", "readme": "short"}
    assert health(good, TODAY) > 0.9 > health(stale, TODAY)
    assert health({**good, "archived": True}, TODAY) < 0.1


def test_momentum_from_snapshots_and_estimate():
    hist = [(date(2026, 10, 10), 900), (date(2026, 10, 16), 1000)]
    m = momentum(1300, hist, "2025-01-01T00:00:00Z", TODAY)
    assert m == {"d7": 300, "d30": None, "est": False}
    young = momentum(700, [], "2026-10-09T00:00:00Z", TODAY)  # 14 days old, no history yet
    assert young["est"] and young["d7"] == 350
    assert momentum_score({"d7": 600}, 800) > momentum_score({"d7": 600}, 90000)


def test_ai_compat_tags():
    tags = ai_compat({"full_name": "x/y", "description": "An MCP server for Claude Desktop", "topics": ["ollama"], "readme": ""})
    assert {"mcp", "claude", "local"} <= set(tags)


def test_creator_gates_and_trust():
    reels = [{"creator": "a", "posted": date(2026, 10, d), "repo_ok": ok, "likes": 9000, "comments": 300, "views": 120000}
             for d, ok in [(1, True), (5, True), (12, True), (20, False), (22, True)]]
    t = creator_trust({"handle": "a", "followers": 150_000}, reels, TODAY)
    assert t["eligible"] and t["accuracy"] == 0.8 and 0 < t["trust"] <= 1
    small = creator_trust({"handle": "a", "followers": 20_000}, reels, TODAY)
    assert not small["eligible"] and small["badge"] == "pending" and "followers" in small["reasons"][0]


# ---------- query understanding & ranking ----------
def test_understand_extracts_facets():
    f = understand("I'm job hunting in Pune for data roles and want something that scrapes LinkedIn and works with Claude, in Python")
    assert f["location"] == "Pune"
    assert "linkedin" in f["platforms"] and "claude" in f["ai"] and f["language"] == "Python"
    assert "job-search" in f["categories"]


def test_bm25_ranks_relevant_doc_first():
    docs = [tokens("browser automation agent playwright"), tokens("job search scraper linkedin indeed"), tokens("text to speech voices")]
    s = BM25(docs).scores(tokens("scrape jobs from linkedin"))
    assert s.argmax() == 1


# ---------- quality ----------
def test_quality_flags_misalignment_and_unknown_creators():
    repos = [{"full_name": f"o/r{i}", "url": "u", "stars": 1, "mo": {}} for i in range(150)]
    checks = {c["name"]: c["status"] for c in quality.run(repos, 149, [{"creator": "ghost", "url": "x", "repo": "o/r1"}], [], 0)}
    assert checks["embeddings aligned"] == "fail"
    assert checks["reels reference known creators"] == "fail"
    assert checks["catalog not empty"] == "pass"


def test_clean_readme_strips_markup():
    md = '<p align="center"><img src="x"></p>\n# Title\n[![badge](b)](l) Fast **tool** for [docs](http://x).\n```bash\npip install x\n```'
    assert clean_readme(md) == "Title Fast tool for docs."


def test_quality_blocks_reels_pointing_to_unresolved_repositories():
    repos = [{"full_name": f"o/r{i}", "url": "u", "stars": 1, "mo": {}} for i in range(150)]
    checks = {c['name']: c['status'] for c in quality.run(repos, 150, [{"creator": "a", "url": "x", "repo": "missing/repo"}], [{"handle": "a"}], 0)}
    assert checks['reels reference known repositories'] == 'fail'


def test_shard_key_matches_the_browser():
    from pipeline.text import shard_key
    # web/src/lib/reels.test.ts asserts the same three keys for data.ts shardKey()
    assert [shard_key("browser-use/browser-use"), shard_key("Ramakm/AI-Engineering"), shard_key("f/prompts.chat")] == ["a0", "9b", "db"]
