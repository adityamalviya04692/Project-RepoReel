"""Automated reel discovery. Each run:
  1. picks today's topics (rotating hashtags/keywords about repos and AI tools)
  2. pulls recent reels for them (Apify free plan, behind a budget guard) and the latest reels of
     known creators (Meta Business Discovery, free)
  3. normalises everything into one shape, merges it into a 120-day history (deduped by shortcode)
  4. fills in follower counts for new creators (Graph API first, a few capped Apify lookups otherwise)
The pipeline then matches captions to repositories; only reels that resolve to a real repo are shown."""
from __future__ import annotations

import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

from .config import (APIFY_TOKEN, HISTORY, PROFILE_LOOKUPS_PER_RUN, REEL_HISTORY_DAYS, REEL_TOPICS, REELS_PER_TOPIC, TOPICS_PER_RUN)
from .sources import apify, instagram_graph

REELS_FILE = HISTORY / "reels.json"
CREATORS_FILE = HISTORY / "creators_auto.json"


def pick_topics(day: date, topics: list[dict] = REEL_TOPICS, n: int = TOPICS_PER_RUN) -> list[dict]:
    """A different slice every day; every topic comes round within len(topics)/n days."""
    start = (day.toordinal() * n) % len(topics)
    return [topics[(start + i) % len(topics)] for i in range(min(n, len(topics)))]


def _int(v) -> Optional[int]:
    try:
        v = int(v)
        return v if v >= 0 else None  # Apify reports hidden like counts as -1
    except (TypeError, ValueError):
        return None


def normalize_apify(item: dict, topic: str) -> Optional[dict]:
    code = item.get("shortCode") or item.get("shortcode")
    owner = (item.get("ownerUsername") or "").lower()
    is_reel = item.get("productType") == "clips" or str(item.get("type", "")).lower() == "video"
    if not code or not owner or not is_reel:
        return None
    return {
        "shortcode": code, "url": f"https://www.instagram.com/reel/{code}/", "creator": owner,
        "posted": (item.get("timestamp") or "")[:10] or date.today().isoformat(), "caption": (item.get("caption") or "")[:2000],
        "likes": _int(item.get("likesCount")), "comments": _int(item.get("commentsCount")),
        "views": _int(item.get("videoPlayCount") or item.get("videoViewCount")),
        "hashtags": item.get("hashtags") or [], "mentions": item.get("mentions") or [], "source": f"apify:{topic}",
    }


def normalize_graph(username: str, m: dict) -> Optional[dict]:
    if m.get("media_product_type") != "REELS" and m.get("media_type") != "VIDEO":
        return None
    link = m.get("permalink") or ""
    code = link.rstrip("/").split("/")[-1]
    if not code:
        return None
    return {
        "shortcode": code, "url": f"https://www.instagram.com/reel/{code}/", "creator": username.lower(),
        "posted": (m.get("timestamp") or "")[:10], "caption": (m.get("caption") or "")[:2000],
        "likes": _int(m.get("like_count")), "comments": _int(m.get("comments_count")), "views": None,
        "hashtags": [], "mentions": [], "source": "graph:business_discovery",
    }


def merge(history: list[dict], new: list[dict], today: date, keep_days: int = REEL_HISTORY_DAYS) -> list[dict]:
    """Dedupe by shortcode (newest stats win, first-seen date kept); drop reels older than the window."""
    by: dict[str, dict] = {r["shortcode"]: r for r in history}
    for r in new:
        old = by.get(r["shortcode"])
        by[r["shortcode"]] = {**(old or {}), **{k: v for k, v in r.items() if v not in (None, "", [])}, "first_seen": (old or {}).get("first_seen") or today.isoformat()}
    cutoff = (today - timedelta(days=keep_days)).isoformat()
    return sorted((r for r in by.values() if (r.get("posted") or r["first_seen"]) >= cutoff), key=lambda r: r.get("posted") or "", reverse=True)


def _load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def discover(today: date, log: Callable[[str], None] = print) -> dict:
    """Runs the free sources that are configured. Returns {'reels': [...], 'creators': {...}, 'stats': {...}}."""
    history: list[dict] = _load(REELS_FILE, [])
    creators: dict[str, dict] = _load(CREATORS_FILE, {})
    new: list[dict] = []
    stats = {"apify": "not configured", "graph": "not configured", "topics": [], "fetched": 0, "budget": None}

    # 1. Apify topic search (free monthly credit, guarded)
    if APIFY_TOKEN:
        u = apify.usage()
        stats["budget"] = u
        if apify.budget_ok(u):
            for t in pick_topics(today):
                try:
                    items = apify.topic_reels(t, REELS_PER_TOPIC)
                except RuntimeError as e:
                    log(f"  apify {t['q']}: {e}")
                    continue
                got = [x for x in (normalize_apify(i, t["q"]) for i in items) if x]
                new += got
                stats["topics"].append({"q": t["q"], "kind": t["kind"], "reels": len(got)})
                log(f"  apify {t['kind']} {t['q']!r}: {len(got)} reels")
            stats["apify"] = "ok"
        else:
            stats["apify"] = "skipped: monthly free credit nearly used" if u else "skipped: usage unavailable"

    # 2. Graph API: latest reels + followers for creators we already know (free)
    if instagram_graph.configured():
        known = sorted(creators, key=lambda h: -creators[h].get("repo_reels", 0))[:40]
        n = 0
        for h in known:
            bd = instagram_graph.business_discovery(h)
            if not bd:
                continue
            creators[h].update(followers=bd.get("followers_count"), followers_source="graph", checked=today.isoformat())
            new += [x for x in (normalize_graph(h, m) for m in (bd.get("media") or {}).get("data", [])) if x]
            n += 1
        stats["graph"] = f"ok · {n} creators refreshed"

    stats["fetched"] = len(new)
    history = merge(history, new, today)
    for r in history:
        creators.setdefault(r["creator"], {"followers": None, "first_seen": r.get("first_seen")})
    return {"reels": history, "creators": creators, "stats": stats}


def fill_followers(creators: dict[str, dict], priority: list[str], today: date, log: Callable[[str], None] = print) -> int:
    """Follower counts for creators who still lack one, most promising first. Graph first (free);
    otherwise a few Apify profile lookups per run within the budget."""
    todo = [h for h in priority if creators.get(h, {}).get("followers") is None]
    done = 0
    if instagram_graph.configured():
        for h in todo[:25]:
            bd = instagram_graph.business_discovery(h)
            if bd and bd.get("followers_count") is not None:
                creators[h].update(followers=bd["followers_count"], followers_source="graph", checked=today.isoformat())
                done += 1
        todo = [h for h in todo if creators[h].get("followers") is None]
    if APIFY_TOKEN and todo and apify.budget_ok(apify.usage()):
        try:
            for p in apify.profiles(todo[:PROFILE_LOOKUPS_PER_RUN]):
                h = (p.get("username") or "").lower()
                if h in creators and p.get("followersCount") is not None:
                    creators[h].update(followers=int(p["followersCount"]), followers_source="apify", checked=today.isoformat(),
                                       business=p.get("isBusinessAccount"), verified=p.get("verified"))
                    done += 1
        except RuntimeError as e:
            log(f"  apify profiles: {e}")
    return done


def save(reels: list[dict], creators: dict[str, dict]) -> None:
    HISTORY.mkdir(parents=True, exist_ok=True)
    REELS_FILE.write_text(json.dumps(reels, indent=1, ensure_ascii=False))
    CREATORS_FILE.write_text(json.dumps(creators, indent=1, sort_keys=True))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")
