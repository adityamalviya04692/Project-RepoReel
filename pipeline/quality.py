"""Data-quality checks. A failing check stops the run before anything is published."""
from __future__ import annotations

from dataclasses import asdict, dataclass


@dataclass
class Check:
    name: str
    status: str  # pass | warn | fail
    detail: str


def run(repos: list[dict], vec_rows: int, reels: list[dict], creators: list[dict], prev_count: int) -> list[dict]:
    checks: list[Check] = []

    def add(name: str, ok: bool, detail: str, warn_only: bool = False) -> None:
        checks.append(Check(name, "pass" if ok else ("warn" if warn_only else "fail"), detail))

    names = [r["full_name"].lower() for r in repos]
    add("catalog not empty", len(repos) > 100, f"{len(repos)} repositories")
    add("unique repositories", len(names) == len(set(names)), f"{len(names) - len(set(names))} duplicates")
    add("required fields present", all(r["full_name"] and r["url"] for r in repos), "full_name and url on every row")
    add("stars non-negative", all(r["stars"] >= 0 for r in repos), "stars ≥ 0")
    add("embeddings aligned", vec_rows == len(repos), f"{vec_rows} vectors for {len(repos)} repos")
    if prev_count:
        drop = (prev_count - len(repos)) / prev_count
        add("catalog size stable", drop < 0.3, f"{prev_count} → {len(repos)} ({-drop:+.0%})", warn_only=True)
    handles = {c["handle"] for c in creators}
    unknown = sorted({r["creator"] for r in reels if r["creator"]} - handles)  # "" = hashtag reel, owner not exposed by Meta
    add("reels reference known creators", not unknown, f"unknown: {', '.join(unknown)}" if unknown else f"{len(reels)} reels, {len(creators)} creators")
    orphaned = [r["url"] for r in reels if r.get("repo") and r["repo"].lower() not in set(names)]
    add("reels reference known repositories", not orphaned, f"{len(orphaned)} unresolved references" if orphaned else "all repository references resolved")
    unmatched = [r["url"] for r in reels if not r.get("repo")]
    add("every reel matched to a repo", not unmatched, f"{len(unmatched)} unmatched (see review queue)" if unmatched else "all matched", warn_only=True)
    big_jumps = [r["full_name"] for r in repos if (r["mo"].get("d7") or 0) > max(5000, r["stars"] * 0.9) and not r["mo"].get("est")]
    add("plausible star velocity", not big_jumps, f"suspicious: {', '.join(big_jumps[:5])}" if big_jumps else "no anomalies", warn_only=True)
    return [asdict(c) for c in checks]
