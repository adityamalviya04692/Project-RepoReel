"""Apify (free plan: $5 of usage every month) for automated Instagram reel discovery.

Every call goes through a budget guard that reads Apify's own usage API and stops before the
free monthly credit is used up, so the project never costs money."""
from __future__ import annotations

from typing import Optional

from ..config import APIFY_MONTHLY_CAP_USD, APIFY_TOKEN
from ..http import request

API = "https://api.apify.com/v2"
HASHTAG_ACTOR = "apify~instagram-hashtag-scraper"
PROFILE_ACTOR = "apify~instagram-profile-scraper"


def usage(token: str = APIFY_TOKEN) -> Optional[dict]:
    """{'used': $, 'cap': $, 'resets': iso} from GET /users/me/limits, or None if unavailable."""
    if not token:
        return None
    r = request("GET", f"{API}/users/me/limits", params={"token": token})
    if r.status_code != 200:
        return None
    d = r.json().get("data", {})
    return {"used": float(d.get("current", {}).get("monthlyUsageUsd") or 0), "plan_cap": float(d.get("limits", {}).get("maxMonthlyUsageUsd") or 0),
            "resets": (d.get("monthlyUsageCycle") or {}).get("endAt")}


def budget_ok(u: Optional[dict], cap: float = APIFY_MONTHLY_CAP_USD, reserve: float = 0.25) -> bool:
    """True while this month's usage leaves room for another run under our self-imposed cap."""
    return bool(u) and u["used"] + reserve < cap


def run_actor(actor: str, payload: dict, token: str = APIFY_TOKEN, timeout: int = 280) -> list[dict]:
    r = request("POST", f"{API}/acts/{actor}/run-sync-get-dataset-items", params={"token": token, "timeout": timeout}, json=payload, timeout=timeout + 30)
    if r.status_code not in (200, 201):
        raise RuntimeError(f"Apify {actor}: HTTP {r.status_code} {r.text[:200]}")
    data = r.json()
    return data if isinstance(data, list) else []


def topic_reels(topic: dict, limit: int) -> list[dict]:
    payload = {"hashtags": [topic["q"]], "resultsType": "reels", "resultsLimit": limit}
    if topic["kind"] == "keyword":
        payload["keywordSearch"] = True
    return run_actor(HASHTAG_ACTOR, payload)


def profiles(usernames: list[str]) -> list[dict]:
    return run_actor(PROFILE_ACTOR, {"usernames": usernames}) if usernames else []
