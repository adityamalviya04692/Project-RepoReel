"""Hacker News source (Algolia API): stories that link to GitHub repositories."""
from __future__ import annotations

import re
import time
from collections import defaultdict
from datetime import datetime, timedelta, timezone

from ..config import HN_DAYS
from ..http import request

API = "https://hn.algolia.com/api/v1/search_by_date"
REPO_URL = re.compile(r"github\.com/([A-Za-z0-9_.-]+)/([A-Za-z0-9_.-]+)", re.I)
NOT_REPOS = {"orgs", "sponsors", "topics", "features", "marketplace", "settings", "about", "collections", "trending", "apps", "login"}


def repo_from_url(url: str):
    m = REPO_URL.search(url or "")
    if not m or m.group(1).lower() in NOT_REPOS:
        return None
    name = re.sub(r"\.git$", "", m.group(2))
    return f"{m.group(1)}/{name}"


def mentions(log=print) -> dict[str, dict]:
    """full_name (lower) → {count, points, latest, top_url, top_title}. One query per day window."""
    out: dict[str, dict] = defaultdict(lambda: {"count": 0, "points": 0, "latest": "", "top_points": -1, "top_url": "", "top_title": ""})
    end = datetime.now(timezone.utc)
    for day in range(HN_DAYS):
        hi = end - timedelta(days=day)
        lo = hi - timedelta(days=1)
        r = request("GET", API, params={"query": "github.com", "tags": "story", "hitsPerPage": 1000,
                                        "numericFilters": f"created_at_i>{int(lo.timestamp())},created_at_i<={int(hi.timestamp())}"})
        if r.status_code != 200:
            continue
        for h in r.json().get("hits", []):
            name = repo_from_url(h.get("url") or "")
            if not name:
                continue
            m = out[name.lower()]
            pts = h.get("points") or 0
            m["count"] += 1
            m["points"] += pts
            m["full_name"] = name
            m["latest"] = max(m["latest"], h.get("created_at") or "")
            if pts > m["top_points"]:
                m.update(top_points=pts, top_url=f"https://news.ycombinator.com/item?id={h['objectID']}", top_title=h.get("title") or "")
        time.sleep(0.3)
    log(f"  hn: {len(out)} repos mentioned in the last {HN_DAYS} days")
    return dict(out)
