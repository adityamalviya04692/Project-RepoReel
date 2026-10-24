"""Meta's official Instagram Graph API (free). Needs IG_USER_ID + IG_ACCESS_TOKEN (Instagram API with Facebook Login).

  business_discovery(): profile + one page of media for any public Business/Creator account; the cursor
                        pages back through their whole history, reels with captions included
  hashtag_recent():     public posts tagged with a hashtag in the last 24 hours (needs the app's
                        Instagram Public Content Access feature; Meta allows 30 unique hashtags per 7 days)

Meta allows ~200 calls per hour per app user. Every response carries usage headers; has_budget()
turns false at 75% so a run never trips the limit."""
from __future__ import annotations

import json
from typing import Optional

import httpx

from ..config import GRAPH, IG_ACCESS_TOKEN, IG_USER_ID
from ..http import request

MEDIA_FIELDS = "id,caption,permalink,timestamp,media_type,media_product_type,like_count,comments_count,thumbnail_url"
HASHTAG_FIELDS = "id,caption,permalink,timestamp,media_type,like_count,comments_count"
RATE_LIMIT_CODES = {4, 17, 32, 613, 80002}
usage = {"calls": 0, "pct": 0.0, "error": "", "last": "ok"}  # last: ok | missing | rate | token | permission | network


def configured() -> bool:
    return bool(IG_USER_ID and IG_ACCESS_TOKEN)


def has_budget(stop_at: float = 75.0) -> bool:
    return usage["pct"] < stop_at and not fatal()


def fatal() -> bool:
    """Errors no amount of waiting fixes within a run."""
    return usage["error"].startswith(("token", "permission"))


def _track(r: httpx.Response) -> None:
    usage["calls"] += 1
    pct = usage["pct"]
    for h in ("x-app-usage", "x-business-use-case-usage"):
        try:
            v = json.loads(r.headers.get(h) or "null")
        except ValueError:
            continue
        if not isinstance(v, dict):
            continue
        rows = [v] if "call_count" in v else [x for xs in v.values() if isinstance(xs, list) for x in xs if isinstance(x, dict)]
        for row in rows:
            pct = max(pct, *(float(row.get(k) or 0) for k in ("call_count", "total_cputime", "total_time")))
    usage["pct"] = pct


def _get(path: str, params: dict) -> Optional[dict]:
    try:
        r = request("GET", f"{GRAPH}/{path}", retries=1, params={**params, "access_token": IG_ACCESS_TOKEN})
    except httpx.HTTPError as e:
        usage.update(error=f"network: {type(e).__name__}", last="network")
        return None
    _track(r)
    if r.status_code == 200:
        usage["last"] = "ok"
        return r.json()
    try:
        err = r.json().get("error") or {}
    except ValueError:
        err = {}
    code = err.get("code")
    if code in RATE_LIMIT_CODES or r.status_code == 429:
        usage.update(pct=100.0, last="rate")
    elif code in (102, 190) or r.status_code == 401:
        usage.update(error="token invalid or expired", last="token")
    elif code == 10 or "permission" in str(err.get("message", "")).lower():
        usage.update(error=f"permission missing: {str(err.get('message', ''))[:80]}", last="permission")
    else:  # e.g. 110 / 100: not a Business or Creator account, private, renamed or gone
        usage["last"] = "missing"
    return None


def business_discovery(username: str, after: Optional[str] = None, limit: int = 30) -> Optional[dict]:
    """Profile + one page of media for a public Business/Creator account, or None (personal, private or unknown)."""
    media = f"media.limit({limit})" + (f".after({after})" if after else "")
    d = _get(IG_USER_ID, {"fields": f"business_discovery.username({username}){{username,followers_count,media_count,{media}{{{MEDIA_FIELDS}}}}}"})
    return (d or {}).get("business_discovery")


def next_cursor(bd: dict) -> Optional[str]:
    """Cursor for the next (older) page of a business_discovery result, or None at the end of the history."""
    paging = (bd.get("media") or {}).get("paging") or {}
    return (paging.get("cursors") or {}).get("after") if paging.get("next") else None


def hashtag_id(tag: str) -> Optional[str]:
    d = _get("ig_hashtag_search", {"user_id": IG_USER_ID, "q": tag})
    rows = (d or {}).get("data") or []
    return rows[0].get("id") if rows else None


def hashtag_recent(hid: str, pages: int = 2) -> list[dict]:
    out: list[dict] = []
    params = {"user_id": IG_USER_ID, "fields": HASHTAG_FIELDS, "limit": 50}
    for _ in range(pages):
        if not has_budget():
            break
        d = _get(f"{hid}/recent_media", params)
        if not d:
            break
        out += d.get("data") or []
        paging = d.get("paging") or {}
        after = (paging.get("cursors") or {}).get("after")
        if not after or not paging.get("next"):
            break
        params = {**params, "after": after}
    return out
