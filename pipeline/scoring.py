"""Scores: repo health, momentum (from our own star snapshots), AI-tool compatibility, creator trust."""
from __future__ import annotations

import math
from datetime import date, datetime, timezone
from typing import Optional

from .config import AI_COMPAT, CREATOR_MIN_FOLLOWERS, CREATOR_MIN_POSTS_60D, CREATOR_TOP_FOLLOWERS, TRUST_WEIGHTS


def _days_since(iso: str, today: Optional[date] = None) -> float:
    if not iso:
        return 9999.0
    d = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    now = datetime.combine(today, datetime.min.time(), timezone.utc) if today else datetime.now(timezone.utc)
    return max(0.0, (now - d).total_seconds() / 86400)


def health(r: dict, today: Optional[date] = None) -> float:
    """0–1: recently pushed, not archived, licensed, released, documented."""
    if r.get("archived"):
        return 0.05
    push = _days_since(r.get("pushed_at", ""), today)
    activity = 1.0 if push <= 30 else max(0.0, 1 - (push - 30) / 335)  # linear to 0 at a year
    lic = 1.0 if r.get("license") and r["license"] != "NOASSERTION" else 0.0
    rel = 1.0 if r.get("latest_release") and _days_since(r["latest_release"], today) < 365 else 0.0
    docs = min(1.0, len(r.get("readme", "")) / 3000)
    return round(0.5 * activity + 0.2 * lic + 0.15 * rel + 0.15 * docs, 3)


def momentum(stars_now: int, history: list[tuple[date, int]], created_at: str, today: date) -> dict:
    """Δ stars over 7 and 30 days from snapshots; for young repos without history, an estimate from age."""
    def delta(days: int) -> Optional[int]:
        older = [s for d, s in history if (today - d).days >= days]
        return stars_now - older[-1] if older else None

    d7, d30 = delta(7), delta(30)
    est = False
    age = max(1.0, _days_since(created_at, today))
    if d7 is None and age <= 90:
        d7, est = round(stars_now / age * 7), True
    if d30 is None and age <= 90:
        d30, est = round(stars_now / age * min(30, age)), True
    return {"d7": d7, "d30": d30, "est": est}


def momentum_score(m: dict, stars: int) -> float:
    """0–1, log-scaled weekly gain relative to size, so a 200→800 repo can beat a 90k→90.3k one."""
    d7 = m.get("d7")
    if d7 is None:
        return 0.0
    abs_part = math.log1p(max(0, d7)) / math.log1p(5000)
    rel_part = min(1.0, max(0, d7) / max(50, stars) * 4)
    return round(min(1.0, 0.6 * abs_part + 0.4 * rel_part), 3)


def ai_compat(r: dict) -> list[str]:
    text = " ".join([r.get("full_name", ""), r.get("description", ""), " ".join(r.get("topics", [])), r.get("readme", "")[:6000]]).lower()
    return [k for k, words in AI_COMPAT.items() if any(w in text for w in words)]


def creator_trust(c: dict, reels: list[dict], today: date) -> dict:
    """Gates (followers, regular posting) plus trust = accuracy, consistency, engagement, recency."""
    mine = [r for r in reels if r["creator"] == c["handle"]]
    recent = [r for r in mine if (today - r["posted"]).days <= 60]
    posts_60d = c.get("repo_posts_60d") if c.get("repo_posts_60d") is not None else len(recent)
    judged = [r for r in mine if r.get("repo_ok") is not None]
    accuracy = sum(1 for r in judged if r["repo_ok"]) / len(judged) if judged else 0.5
    consistency = min(1.0, posts_60d / 8)
    rates = [((r.get("likes") or 0) + (r.get("comments") or 0)) / r["views"] for r in mine if r.get("views")]
    engagement = min(1.0, (sum(rates) / len(rates)) / 0.08) if rates else 0.5  # ~8% of views engaging = excellent
    last = max((r["posted"] for r in mine), default=None)
    recency = math.exp(-((today - last).days) / 30) if last else 0.0
    w = TRUST_WEIGHTS
    trust = w["accuracy"] * accuracy + w["consistency"] * consistency + w["engagement"] * engagement + w["recency"] * recency
    eligible = c["followers"] >= CREATOR_MIN_FOLLOWERS and posts_60d >= CREATOR_MIN_POSTS_60D
    reasons = []
    if c["followers"] < CREATOR_MIN_FOLLOWERS:
        reasons.append(f"needs {CREATOR_MIN_FOLLOWERS:,}+ followers")
    if posts_60d < CREATOR_MIN_POSTS_60D:
        reasons.append(f"needs {CREATOR_MIN_POSTS_60D}+ repo posts in 60 days (has {posts_60d})")
    badge = "top" if eligible and c["followers"] >= CREATOR_TOP_FOLLOWERS and trust >= 0.7 else "verified" if eligible else "pending"
    return {
        "handle": c["handle"], "followers": c["followers"], "niche": c.get("niche", ""), "reels": len(mine), "posts_60d": posts_60d,
        "accuracy": round(accuracy, 3), "consistency": round(consistency, 3), "engagement": round(engagement, 3), "recency": round(recency, 3),
        "trust": round(trust, 3), "eligible": eligible, "badge": badge, "reasons": reasons,
    }
