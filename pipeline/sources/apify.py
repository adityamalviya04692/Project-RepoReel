"""Budget-checked Apify discovery. Account-level limits remain the spending backstop."""
from __future__ import annotations

import math
from datetime import date, datetime
from typing import Optional

import httpx

from ..config import APIFY_MAX_RESULTS_PER_RUN, APIFY_MONTHLY_CAP_USD, APIFY_TOKEN, APIFY_USD_PER_RESULT
from ..http import request

API = "https://api.apify.com/v2"
HASHTAG_ACTOR = "apify~instagram-hashtag-scraper"
PROFILE_ACTOR = "apify~instagram-profile-scraper"
REEL_ACTOR = "apify~instagram-reel-scraper"
RUN_CAP_USD = 0.25


def usage(token: str = APIFY_TOKEN) -> Optional[dict]:
    """Return validated usage, or fail closed when it cannot be verified."""
    if not token:
        return None
    try:
        r = request("GET", f"{API}/users/me/limits", headers={"Authorization": f"Bearer {token}"})
        if r.status_code != 200:
            return None
        d = r.json()["data"]
        used = float(d["current"]["monthlyUsageUsd"])
        cap = float(d["limits"]["maxMonthlyUsageUsd"])
        if not math.isfinite(used) or not math.isfinite(cap) or used < 0 or cap <= 0:
            return None
        return {"used": used, "plan_cap": cap, "resets": (d.get("monthlyUsageCycle") or {}).get("endAt")}
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        return None


def budget_ok(u: Optional[dict], cap: float = APIFY_MONTHLY_CAP_USD, reserve: float = RUN_CAP_USD) -> bool:
    if not u:
        return False
    try:
        used, plan = float(u["used"]), float(u["plan_cap"])
        return all(math.isfinite(v) for v in (used, plan, cap, reserve)) and used >= 0 and reserve > 0 and used + reserve < min(cap, plan)
    except (KeyError, TypeError, ValueError):
        return False


def run_actor(actor: str, payload: dict, token: str = APIFY_TOKEN, timeout: int = 280) -> list[dict]:
    # Recheck before EVERY paid launch, including creator lookups. Never retry a POST:
    # a timed-out response can belong to a run that is still executing and charging.
    if not token or not budget_ok(usage(token)):
        raise RuntimeError("Apify launch skipped: budget unavailable or cap reached")
    try:
        r = request("POST", f"{API}/acts/{actor}/run-sync-get-dataset-items", retries=0,
                    headers={"Authorization": f"Bearer {token}"},
                    params={"timeout": timeout, "maxTotalChargeUsd": RUN_CAP_USD}, json=payload, timeout=timeout + 30)
        if r.status_code not in (200, 201):
            raise RuntimeError(f"Apify {actor}: HTTP {r.status_code}")
        data = r.json()
        if not isinstance(data, list) or any(not isinstance(i, dict) for i in data):
            raise RuntimeError("Apify returned an invalid dataset")
        return data
    except (httpx.HTTPError, ValueError) as e:
        raise RuntimeError("Apify request failed; not retried to avoid duplicate charges") from e


def topic_reels(topic: dict, limit: int) -> list[dict]:
    payload = {"hashtags": [topic["q"]], "resultsType": "reels", "resultsLimit": limit}
    if topic["kind"] == "keyword":
        payload["keywordSearch"] = True
    return run_actor(HASHTAG_ACTOR, payload)


def creator_reels(usernames: list[str], per: int) -> list[dict]:
    """Newest reels from several creators in one actor run (one start fee instead of one per creator)."""
    return run_actor(REEL_ACTOR, {"username": usernames, "resultsLimit": per}) if usernames and per > 0 else []


def allowance(u: Optional[dict], today: date, cap: float = APIFY_MONTHLY_CAP_USD, reserve: float = RUN_CAP_USD) -> int:
    """Results this run may buy: the credit left under the cap, spread evenly over the days left in the cycle."""
    if not budget_ok(u, cap, reserve):
        return 0
    left = min(cap, float(u["plan_cap"])) - float(u["used"]) - reserve
    try:
        days = max(1, (datetime.fromisoformat(str(u.get("resets"))[:10]).date() - today).days + 1)
    except ValueError:
        days = 30
    return max(0, min(APIFY_MAX_RESULTS_PER_RUN, int(left / days / APIFY_USD_PER_RESULT)))


def profiles(usernames: list[str]) -> list[dict]:
    return run_actor(PROFILE_ACTOR, {"usernames": usernames}) if usernames else []
