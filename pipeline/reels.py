"""Automated reel discovery, built around creators rather than hashtags. Each run:
  1. finds new posts about repos: Graph hashtag search (last 24 h, free) and a few precise Apify
     hashtag/keyword searches (free monthly credit, spread evenly over the cycle)
  2. classifies every new reel: English caption about a repo (pipeline.classify); rejects are remembered
     so they are never fetched or judged again
  3. any creator with English repo reels becomes a *repo creator*; their feeds are read next: Graph
     Business Discovery (free, pages back through their whole history) or Apify reel feeds otherwise.
     Creator feeds are where volume comes from: most of a repo creator's reels are repo reels.
  4. reels whose caption hides the repo ("comment REPO") get their cover read with Tesseract
History keeps every repo reel (no expiry); the pipeline then matches captions to repositories."""
from __future__ import annotations

import json
import re
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Callable, Optional

from . import ocr
from .classify import english, keep
from .config import (APIFY_FEED_PER_CREATOR, APIFY_TOKEN, APIFY_TOPIC_SHARE, CRAWL_MINUTES, GRAPH_CALLS_PER_RUN, GRAPH_HASHTAG_PAGES, GRAPH_HASHTAGS,
                     GRAPH_MEDIA_PAGE, GRAPH_PAUSE_SECONDS, HISTORY, OCR_PER_RUN, PROFILE_LOOKUPS_PER_RUN, REEL_BACKFILL_DAYS, REEL_TOPICS, TOPICS_PER_RUN)
from .matching import URL as GITHUB_URL, OWNER_REPO
from .sources import apify, instagram_graph

REELS_FILE = HISTORY / "reels.json"              # pre-sharding single file; migrated into reels/ on the next save
CREATORS_FILE = HISTORY / "creators_auto.json"
REJECTED_FILE = HISTORY / "reels_rejected.json"   # shortcodes judged not English / not about a repo
HASHTAGS_FILE = HISTORY / "graph_hashtags.json"   # hashtag → Graph id (searching again counts against Meta's weekly limit)
REJECTED_MAX = 300_000
GRAPH_RETRY_DAYS = 30                             # personal/private accounts: try Business Discovery again after this
MENTION = re.compile(r"(?<![\w.@])@([A-Za-z0-9._]{2,30})")
_now, _sleep = time.monotonic, time.sleep         # replaced in tests


def mentions(caption: str, author: str) -> set[str]:
    """Handles tagged in a caption ("credit @x", collabs): candidates for the creator graph."""
    return {m.rstrip(".").lower() for m in MENTION.findall(caption or "")} - {author, ""}


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


def normalize_apify(item: dict, source: str) -> Optional[dict]:
    code = item.get("shortCode") or item.get("shortcode")
    owner = (item.get("ownerUsername") or "").lower()
    is_reel = item.get("productType") == "clips" or str(item.get("type", "")).lower() == "video"
    if not code or not owner or not is_reel or not item.get("timestamp"):
        return None
    return {
        "shortcode": code, "url": f"https://www.instagram.com/reel/{code}/", "creator": owner,
        "posted": (item.get("timestamp") or "")[:10], "caption": (item.get("caption") or "")[:2000],
        "likes": _int(item.get("likesCount")), "comments": _int(item.get("commentsCount")),
        "views": _int(item.get("videoPlayCount") or item.get("videoViewCount")),
        "source": f"apify:{source}", "thumb": item.get("displayUrl") or "",
    }


def normalize_graph(username: str, m: dict, source: str = "graph:business_discovery") -> Optional[dict]:
    """Business Discovery media (username known) or hashtag media (username "" — Meta doesn't expose the owner)."""
    if m.get("media_product_type") != "REELS" and m.get("media_type") != "VIDEO":
        return None
    link = m.get("permalink") or ""
    code = link.rstrip("/").split("/")[-1]
    if not code or not m.get("timestamp"):
        return None
    return {
        "shortcode": code, "url": f"https://www.instagram.com/reel/{code}/", "creator": username.lower(),
        "posted": (m.get("timestamp") or "")[:10], "caption": (m.get("caption") or "")[:2000],
        "likes": _int(m.get("like_count")), "comments": _int(m.get("comments_count")), "views": None,
        "source": source, "thumb": m.get("thumbnail_url") or "",
    }


def merge(history: list[dict], new: list[dict], today: date) -> list[dict]:
    """Dedupe by shortcode (newest stats win, first-seen date kept). Repo reels never expire."""
    by: dict[str, dict] = {r["shortcode"]: r for r in history}
    for r in new:
        old = by.get(r["shortcode"])
        by[r["shortcode"]] = {**(old or {}), **{k: v for k, v in r.items() if v not in (None, "", []) and k != "thumb"},
                              "first_seen": (old or {}).get("first_seen") or today.isoformat()}
    return sorted(by.values(), key=lambda r: (r.get("posted") or "", r["shortcode"]), reverse=True)


def is_repo_creator(c: dict) -> bool:
    """Posts about repos often enough that their feed is worth reading."""
    kept, seen = c.get("kept", 0), max(1, c.get("seen", 0))
    return kept >= 3 or (kept >= 1 and kept / seen >= 0.2)


def needs_ocr(r: dict) -> bool:
    """English reel whose caption doesn't spell out the repo (no github.com link, no owner/name)."""
    caption = r.get("caption") or ""
    return bool(r.get("thumb")) and not r.get("ocr") and english(caption) and not (GITHUB_URL.search(caption) or OWNER_REPO.search(caption))


def _load(path: Path, default):
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _reels_dir() -> Path:
    return REELS_FILE.parent / "reels"  # one file per posting month: small files, small nightly diffs


def load_history() -> list[dict]:
    rows: dict[str, dict] = {}
    for f in sorted(_reels_dir().glob("*.json")) if _reels_dir().exists() else []:
        for r in _load(f, []):
            rows.setdefault(r["shortcode"], r)
    for r in _load(REELS_FILE, []):
        rows.setdefault(r["shortcode"], r)
    return sorted(rows.values(), key=lambda r: (r.get("posted") or "", r["shortcode"]), reverse=True)


class Discovery:
    """One run's state: history, rejects, creator registry and the counts shown on the Pipeline page."""

    def __init__(self, today: date, log: Callable[[str], None]):
        self.today, self.log = today, log
        raw_history = load_history()
        self.history = [r for r in raw_history if keep(r)]  # re-judge older history under the current rules
        self.rejected: set[str] = set(_load(REJECTED_FILE, [])) | {r["shortcode"] for r in raw_history if not keep(r)}
        self.creators: dict[str, dict] = _load(CREATORS_FILE, {})
        self.known = {r["shortcode"] for r in self.history}
        self.updates: list[dict] = []
        self.new: list[dict] = []
        self.ocr_left = OCR_PER_RUN if ocr.available() else 0
        self.stats: dict = {"apify": "not configured", "graph": "not configured", "graph_hashtags": "not configured", "topics": [], "fetched": 0,
                            "kept": 0, "rejected": {"not_english": 0, "off_topic": 0}, "feeds": {"graph": 0, "apify": 0}, "ocr": 0,
                            "budget": None, "allowance": 0, "repo_creators": 0, "creators_seen": 0,
                            "history_pages": 0, "pauses": 0, "backfilled_creators": 0, "candidates": 0}
        # Creator counts start from history so is_repo_creator() works on the first run after an upgrade.
        kept_by: dict[str, int] = {}
        for r in self.history:
            kept_by[r["creator"]] = kept_by.get(r["creator"], 0) + 1
        seen_by: dict[str, int] = {}
        for r in raw_history:
            seen_by[r["creator"]] = seen_by.get(r["creator"], 0) + 1
        for h in set(kept_by) | set(seen_by):
            if not h:
                continue
            c = self.creators.setdefault(h, {"followers": None, "first_seen": today.isoformat()})
            c["kept"] = max(c.get("kept", 0), kept_by.get(h, 0))
            c["seen"] = max(c.get("seen", 0), seen_by.get(h, 0), c["kept"])
        for r in self.history:
            self._candidates(r)

    def _candidates(self, r: dict) -> None:
        """Creators tagged in a repo reel are probed: one call tells whether they post about repos too."""
        for h in mentions(r.get("caption") or "", r.get("creator") or ""):
            if h not in self.creators:
                self.creators[h] = {"followers": None, "first_seen": self.today.isoformat(), "probe": "pending", "via": r.get("creator") or ""}

    def absorb(self, items: list[Optional[dict]]) -> int:
        """Classify freshly fetched reels; returns how many new repo reels were kept."""
        got = 0
        for r in items:
            if not r:
                continue
            self.stats["fetched"] += 1
            code = r["shortcode"]
            if code in self.known:
                self.updates.append(r)  # fresher likes/comments for a reel we already have
                continue
            if code in self.rejected:
                continue
            if self.ocr_left and needs_ocr(r):
                self.ocr_left -= 1
                r["ocr"] = ocr.read(r["thumb"])
                self.stats["ocr"] += bool(r["ocr"])
            c = self.creators.setdefault(r["creator"], {"followers": None, "first_seen": self.today.isoformat()}) if r["creator"] else {}
            c["seen"] = c.get("seen", 0) + 1
            if keep(r):
                c["kept"] = c.get("kept", 0) + 1
                self.known.add(code)
                self.new.append(r)
                self._candidates(r)
                got += 1
            else:
                self.rejected.add(code)
                self.stats["rejected"]["not_english" if not english(r.get("caption") or "") else "off_topic"] += 1
        return got

    def repo_creators(self) -> list[str]:
        return [h for h, c in self.creators.items() if h and is_repo_creator(c)]

    # ---------- sources ----------
    def graph_hashtags(self) -> None:
        ids: dict[str, str] = _load(HASHTAGS_FILE, {})
        n = 0
        for tag in GRAPH_HASHTAGS:
            if not instagram_graph.has_budget():
                break
            hid = ids.get(tag) or instagram_graph.hashtag_id(tag)
            if not hid:
                continue
            ids[tag] = hid
            n += self.absorb([normalize_graph("", m, f"graph:#{tag}") for m in instagram_graph.hashtag_recent(hid, GRAPH_HASHTAG_PAGES)])
        HISTORY.mkdir(parents=True, exist_ok=True)
        HASHTAGS_FILE.write_text(json.dumps(ids, indent=1, sort_keys=True))
        err = instagram_graph.usage["error"]
        self.stats["graph_hashtags"] = f"error: {err}" if err and not ids else f"ok · {n} repo reels from {len(ids)} hashtags"
        if err.startswith("permission"):  # hashtag search needs its own feature; Business Discovery may still work
            instagram_graph.usage["error"] = ""

    def _graph_work(self) -> list[tuple[str, str]]:
        """Today's queue: first pages (repo creators, then tagged candidates), then one older page per
        unfinished history. Every item is one call and changes state, so the queue always shrinks."""
        today, retry = self.today.isoformat(), (self.today - timedelta(days=GRAPH_RETRY_DAYS)).isoformat()

        def open_(h: str) -> bool:
            g = self.creators[h].get("graph") or {}
            return g.get("tried") != today and (g.get("status") != "unavailable" or (g.get("checked") or "") < retry)
        repo = [h for h in self.repo_creators() if open_(h)]
        first = sorted((h for h in repo if (self.creators[h].get("graph") or {}).get("checked") != today),
                       key=lambda h: (self.creators[h].get("graph") or {}).get("checked") or "")
        first += [h for h, c in self.creators.items() if h and c.get("probe") == "pending" and open_(h) and h not in first]
        older = [h for h in repo if (g := self.creators[h].get("graph") or {}).get("status") == "ok" and g.get("checked") == today
                 and not g.get("backfilled") and g.get("after")]
        return [("first", h) for h in first] + [("older", h) for h in older]

    def _graph_page(self, kind: str, h: str) -> int:
        """One Business Discovery call. Returns new repo reels; marks the creator so the queue moves on."""
        c = self.creators[h]
        g = c.setdefault("graph", {})
        bd = instagram_graph.business_discovery(h, after=g.get("after") if kind == "older" else None, limit=GRAPH_MEDIA_PAGE)
        if not bd:
            last = instagram_graph.usage["last"]
            if last == "missing":
                g.update(status="unavailable", checked=self.today.isoformat())
                if c.get("probe") == "pending":
                    c["probe"] = "done"
            elif last == "network":
                g["tried"] = self.today.isoformat()
            return 0  # rate limit / token / permission: the crawl loop pauses or stops
        media = (bd.get("media") or {}).get("data") or []
        got = self.absorb([normalize_graph(h, m) for m in media])
        if kind == "first":
            c.update(followers=bd.get("followers_count"), followers_source="graph", checked=self.today.isoformat())
            if c.get("probe") == "pending":
                c["probe"] = "done"
            if not g.get("backfilled") and not g.get("after"):
                g["after"] = instagram_graph.next_cursor(bd)
                g["backfilled"] = g["after"] is None
            g.update(status="ok", checked=self.today.isoformat())
            self.stats["feeds"]["graph"] += 1
        else:
            cursor = instagram_graph.next_cursor(bd)
            if cursor == g.get("after"):  # a cursor that doesn't move would loop forever
                cursor = None
            since = (self.today - timedelta(days=REEL_BACKFILL_DAYS)).isoformat() if REEL_BACKFILL_DAYS else ""
            if not media or (since and min((m.get("timestamp") or "")[:10] for m in media) < since):
                cursor = None
            g.update(after=cursor, backfilled=cursor is None)
            self.stats["history_pages"] += 1
        return got

    def graph_crawl(self) -> None:
        """Works the queue while Meta's hourly allowance lasts; with CRAWL_MINUTES it pauses until the
        window refreshes and keeps going, so one nightly job reads thousands of pages."""
        deadline = _now() + CRAWL_MINUTES * 60 if CRAWL_MINUTES else None
        calls0, got = instagram_graph.usage["calls"], 0
        self.stats.update(history_pages=0, pauses=0)

        def time_left() -> bool:
            return deadline is None or _now() < deadline

        def calls_left() -> bool:
            return deadline is not None or instagram_graph.usage["calls"] - calls0 < GRAPH_CALLS_PER_RUN
        work = self._graph_work()
        while work and time_left() and calls_left() and not instagram_graph.fatal():
            for kind, h in work:
                if not (instagram_graph.has_budget() and time_left() and calls_left()):
                    break
                got += self._graph_page(kind, h)
            if instagram_graph.fatal() or not calls_left():
                break
            if not instagram_graph.has_budget():
                if deadline is None or deadline - _now() < GRAPH_PAUSE_SECONDS:
                    break
                self.log(f"  graph: hourly allowance used ({instagram_graph.usage['calls'] - calls0} calls); pausing {GRAPH_PAUSE_SECONDS // 60} min")
                _sleep(GRAPH_PAUSE_SECONDS)
                instagram_graph.usage["pct"] = 0.0
                self.stats["pauses"] += 1
            work = self._graph_work()
        repo = self.repo_creators()
        self.stats["backfilled_creators"] = sum(1 for h in repo if (self.creators[h].get("graph") or {}).get("backfilled"))
        self.stats["candidates"] = sum(1 for c in self.creators.values() if c.get("probe") == "pending")
        err = instagram_graph.usage["error"]
        self.stats["graph"] = (f"error: {err}" if err and not self.stats["feeds"]["graph"] else
                               f"ok · {self.stats['feeds']['graph']} feeds · {self.stats['history_pages']} history pages · {got} new repo reels · "
                               f"{instagram_graph.usage['calls'] - calls0} calls")

    def apify_topics(self, results: int) -> None:
        topics = pick_topics(self.today)
        per, failures = max(8, results // max(1, len(topics))), 0
        for t in topics:
            try:
                items = apify.topic_reels(t, per)
            except RuntimeError as e:
                self.log(f"  apify {t['q']}: {e}")
                failures += 1
                continue
            got = self.absorb([normalize_apify(i, t["q"]) for i in items])
            self.stats["topics"].append({"q": t["q"], "kind": t["kind"], "reels": len(items), "kept": got})
            self.log(f"  apify {t['kind']} {t['q']!r}: {len(items)} reels, {got} new repo reels")
        self.stats["apify"] = ("error: no topics completed" if failures == len(topics) else "partial: some topics failed") if failures else "ok"

    def apify_feeds(self, results: int) -> None:
        """Newest reels of repo creators the Graph API can't read (or when it isn't configured)."""
        todo = [h for h in self.repo_creators() if (self.creators[h].get("graph") or {}).get("status") != "ok"]
        todo.sort(key=lambda h: self.creators[h].get("apify_feed") or "")
        batch = todo[: max(0, results // APIFY_FEED_PER_CREATOR)]
        if not batch:
            return
        try:
            items = apify.creator_reels(batch, APIFY_FEED_PER_CREATOR)
        except RuntimeError as e:
            self.log(f"  apify feeds: {e}")
            return
        got = self.absorb([normalize_apify(i, "feed") for i in items])
        for h in batch:
            self.creators[h]["apify_feed"] = self.today.isoformat()
        self.stats["feeds"]["apify"] = len(batch)
        self.log(f"  apify feeds: {len(batch)} creators, {len(items)} reels, {got} new repo reels")

    def run(self) -> dict:
        graph = instagram_graph.configured()
        if graph:
            self.graph_hashtags()
        u = apify.usage() if APIFY_TOKEN else None
        allowance = apify.allowance(u, self.today) if u else 0
        self.stats.update(budget=u, allowance=allowance)
        if APIFY_TOKEN and not allowance:
            self.stats["apify"] = "skipped: monthly free credit nearly used" if u else "skipped: usage unavailable"
        # Feeds' share is reserved even when no repo creator is known yet: topics may find some this run,
        # and any credit left unspent is spread over the remaining days by tomorrow's allowance.
        feed_share = int(allowance * (1 - APIFY_TOPIC_SHARE))
        if allowance:
            self.apify_topics(allowance - feed_share)
        if graph:
            self.graph_crawl()  # includes creators found a moment ago
        if allowance and feed_share:
            self.apify_feeds(feed_share)
            self.stats["budget"] = apify.usage()
        self.stats["kept"] = len(self.new)
        self.stats["repo_creators"] = len(self.repo_creators())
        self.stats["creators_seen"] = len([h for h in self.creators if h])
        self.history = merge(self.history, self.new + self.updates, self.today)
        return {"reels": self.history, "creators": self.creators, "stats": self.stats, "rejected": self.rejected}


def discover(today: date, log: Callable[[str], None] = print) -> dict:
    """Runs the free sources that are configured. Returns {'reels', 'creators', 'stats', 'rejected'}."""
    return Discovery(today, log).run()


def fill_followers(creators: dict[str, dict], priority: list[str], today: date, log: Callable[[str], None] = print) -> int:
    """Follower counts for creators who still lack one, most promising first. Graph first (free);
    otherwise a few Apify profile lookups per run within the budget."""
    todo = [h for h in priority if h and creators.get(h, {}).get("followers") is None]
    done = 0
    if instagram_graph.configured():
        for h in todo[:25]:
            if not instagram_graph.has_budget():
                break
            bd = instagram_graph.business_discovery(h, limit=1)
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


def save(reels: list[dict], creators: dict[str, dict], rejected: Optional[set] = None) -> None:
    """History sharded by posting month, one reel per line: files stay small and nightly diffs stay readable."""
    d = _reels_dir()
    d.mkdir(parents=True, exist_ok=True)
    shards: dict[str, list[dict]] = {}
    for r in reels:
        shards.setdefault((r.get("posted") or "")[:7] or "undated", []).append({k: v for k, v in r.items() if k != "thumb"})
    for name, rows in shards.items():
        (d / f"{name}.json").write_text("[\n" + ",\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n]\n")
    for f in d.glob("*.json"):
        if f.stem not in shards:
            f.unlink()
    REELS_FILE.unlink(missing_ok=True)
    CREATORS_FILE.parent.mkdir(parents=True, exist_ok=True)
    CREATORS_FILE.write_text(json.dumps(creators, indent=1, sort_keys=True))
    if rejected is not None:
        REJECTED_FILE.write_text(json.dumps(sorted(rejected)[-REJECTED_MAX:]))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_replay(bronze: Path) -> list[dict]:
    path = bronze / "reels_discovered.jsonl"
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()] if path.exists() else []
