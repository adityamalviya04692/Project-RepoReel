"""RepoReel pipeline: `python -m pipeline.cli run`.

Stages: discover → hn → curated → enrich → silver → embed → match → score → gold → quality → eval.
Every stage is timed and counted; the run summary feeds the site's Pipeline status page.
"""
from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import time
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np

from . import quality as qa
from . import reels as auto
from .classify import keep
from .config import (BRONZE, CATEGORIES, CREATOR_MIN_FOLLOWERS, CREATOR_MIN_POSTS_60D, GITHUB_TOKEN, GOLD, HISTORY, HN_MIN_POINTS_TO_ADD,
                     MATCH_ACCEPT, MATCH_REVIEW, RANK_WEIGHTS, AI_COMPAT, REELS_PER_REPO_MAX, REELS_PER_REPO_SHARD, REELS_PUBLISH_MAX, REMATCH_DAYS, TODAY,
                     TRUST_WEIGHTS)
from .embed import embed, quantize
from .matching import Resolver, extract
from .rank import BM25, CATEGORY_WORDS, LANGUAGES, PLATFORMS, rank, search_text, tokens
from .scoring import ai_compat, creator_trust, health, momentum, momentum_score
from .sources import curated, github, hn
from .text import clean_readme, shard_key
from .transforms import history_for, silver


class Run:
    def __init__(self) -> None:
        self.stages: list[dict] = []
        self.started = time.time()

    def stage(self, name: str, fn, *a, **kw):
        t0 = time.time()
        print(f"▶ {name}", flush=True)
        result = fn(*a, **kw)
        self.stages.append({"name": name, "seconds": round(time.time() - t0, 2)})
        return result

    def rows(self, **counts) -> None:
        self.stages[-1]["rows"] = counts


def _jsonl(path: Path, rows) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    n = 0
    with path.open("w") as f:
        for r in rows:
            f.write(json.dumps(r, default=str) + "\n")
            n += 1
    return n


def _days(iso: str) -> float:
    return (datetime.now(timezone.utc) - datetime.fromisoformat(iso.replace("Z", "+00:00"))).total_seconds() / 86400 if iso else 9999


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="reporeel")
    ap.add_argument("command", choices=["run"])
    ap.add_argument("--limit", type=int, default=0, help="cap catalog size (for quick local runs)")
    ap.add_argument("--replay", action="store_true", help="rebuild silver/gold from today's bronze files without calling any API")
    ap.add_argument("--resume", action="store_true", help="reuse bronze discovery files and resume missing GitHub enrichment; no repeat topic searches")
    args = ap.parse_args(argv)
    reuse_bronze = args.replay or args.resume
    if not GITHUB_TOKEN and not args.replay:
        print("GITHUB_TOKEN is required (export GITHUB_TOKEN=$(gh auth token))", file=sys.stderr)
        return 2

    run = Run()
    today = TODAY.isoformat()
    bronze = BRONZE / today
    if args.resume and not bronze.exists():
        snapshots = sorted(p for p in BRONZE.glob("????-??-??") if (p / "gh_search_hits.jsonl").exists())
        if snapshots:
            bronze = snapshots[-1]
    if reuse_bronze:
        def _read(name: str) -> list:
            return [json.loads(line) for line in (bronze / name).read_text().splitlines() if line.strip()]
        found = run.stage("discover · replay bronze", lambda: {r["node_id"]: {**r, "categories": set(r["categories"])} for r in _read("gh_search_hits.jsonl")})
        run.rows(repos=len(found))
        hn_hits = run.stage("hn · replay bronze", lambda: {m["full_name"].lower(): m for m in _read("hn_hits.jsonl")})
        run.rows(repos_mentioned=len(hn_hits))
    else:
        shutil.rmtree(bronze, ignore_errors=True)

        # 1–3. sources
        found = run.stage("discover · GitHub search", github.discover)
        run.rows(repos=len(found))
        _jsonl(bronze / "gh_search_hits.jsonl", ({"node_id": k, **v, "categories": sorted(v["categories"])} for k, v in found.items()))

        hn_hits = run.stage("hn · Algolia mentions", hn.mentions)
        run.rows(repos_mentioned=len(hn_hits))
        _jsonl(bronze / "hn_hits.jsonl", hn_hits.values())

    creators_in = run.stage("curated · creators & reels", curated.creators)
    reels_in = curated.reels()
    golden = curated.golden()
    run.rows(creators=len(creators_in), reels=len(reels_in), golden_queries=len(golden))

    # Automated discovery: trending reels about repos (Apify free credit) + known creators (Graph API).
    if reuse_bronze:  # reuse recorded topics; replay never calls source APIs
        disc = run.stage("reels · replay bronze", lambda: {"reels": [r for r in auto._load_replay(bronze) if keep(r)], "rejected": None,
                                                           "creators": auto._load(auto.CREATORS_FILE, {}), "stats": {"fetched": 0, "replay": args.replay, "resumed": args.resume, "apify": "not called (replay)" if args.replay else "reused recorded reels", "graph": "not called (replay)" if args.replay else "not called (resume)", "topics": [], "budget": None}})
    else:
        disc = run.stage("reels · discover on Instagram", auto.discover, TODAY)
        auto.save(disc["reels"], disc["creators"], disc.get("rejected"))  # a long crawl is never lost to a later failure
    run.rows(fetched=disc["stats"]["fetched"], history=len(disc["reels"]), creators_seen=len(disc["creators"]))
    _jsonl(bronze / "reels_discovered.jsonl", disc["reels"])
    curated_urls = {r.url for r in reels_in}
    for r in disc["reels"]:
        if r["url"] in curated_urls or not r.get("posted"):
            continue
        try:
            reels_in.append(curated.Reel(url=r["url"], creator=r["creator"], posted=r["posted"], caption=r.get("caption") or "",
                                         likes=r.get("likes"), comments=r.get("comments"), views=r.get("views")))
        except ValueError:
            continue
    discovered_urls = {r["url"] for r in disc["reels"]}
    ocr_text = {r["url"]: r["ocr"] for r in disc["reels"] if r.get("ocr")}

    # 4. enrich: search hits + strong HN-only repos + repos named in curated reels
    ids = list(found)
    if args.limit:
        ids = ids[: args.limit]
    if args.replay:
        enriched = run.stage("enrich · replay bronze", lambda: [json.loads(l) for l in (bronze / "gh_repo_graphql.jsonl").read_text().splitlines() if l.strip()])
        known = {r["full_name"].lower() for r in enriched}
        missing = [r.repo for r in reels_in if r.repo and r.repo.lower() not in known]
        run.rows(repos=len(enriched), from_hn_or_reels=len(missing))
    else:
        enriched = run.stage("enrich · GitHub GraphQL", github.enrich, ids, checkpoint=bronze / "gh_repo_graphql.jsonl")
        known = {r["full_name"].lower() for r in enriched}
        extra = [m["full_name"] for m in hn_hits.values() if m["full_name"].lower() not in known and m["top_points"] >= HN_MIN_POINTS_TO_ADD]
        extra += [r.repo for r in reels_in if r.repo and r.repo.lower() not in known]
        if extra:
            enriched += github.lookup(extra)
        run.rows(repos=len(enriched), from_hn_or_reels=len(extra))
        _jsonl(bronze / "gh_repo_graphql.jsonl", enriched)

    # 5. silver (DuckDB)
    counts = run.stage("silver · DuckDB transforms", silver, bronze, BRONZE.parent / "silver", HISTORY, today)
    run.rows(**counts)
    import duckdb
    repos = [dict(zip([d[0] for d in cur.description], row)) for cur in [duckdb.connect().execute(f"SELECT * FROM read_parquet('{BRONZE.parent / 'silver' / 'repos.parquet'}') ORDER BY stars DESC")] for row in cur.fetchall()]
    cats = {v["full_name"].lower(): sorted(v["categories"]) for v in found.values()}
    for r in repos:
        for k in ("created_at", "pushed_at", "latest_release"):  # DuckDB auto-types these as timestamps
            v = r.get(k)
            if isinstance(v, datetime):
                r[k] = (v if v.tzinfo else v.replace(tzinfo=timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
            elif v is None:
                r[k] = ""
            else:
                r[k] = str(v)
        r["topics"] = list(r.get("topics") or [])
        r["excerpt"] = clean_readme(r.get("readme") or "", 600)

    # 6. embeddings
    def _embed():
        texts = [f"{r['full_name'].split('/')[1].replace('-', ' ')}. {r['description']}. Topics: {', '.join(r['topics'])}. {clean_readme(r.get('readme') or '', 1200)}" for r in repos]
        return embed(texts)
    vecs = run.stage("embed · all-MiniLM-L6-v2", _embed)
    run.rows(vectors=int(vecs.shape[0]), dims=int(vecs.shape[1]))
    index = {r["full_name"].lower(): i for i, r in enumerate(repos)}

    # 7. match curated reels to repos
    def _match():
        text_vecs: dict[str, np.ndarray] = {}

        def semantic(text: str, full: str) -> float:
            i = index.get(full.lower())
            if i is None:
                return 0.5
            if text not in text_vecs:
                text_vecs[text] = embed([text])[0]
            return float(max(0.0, min(1.0, (text_vecs[text] @ vecs[i] - 0.15) / 0.55)))
        # GitHub search fallback is slow (30/min): cap new searches per run and remember every answer.
        cache_path = HISTORY / "name_search_cache.json"
        cache: dict = json.loads(cache_path.read_text()) if cache_path.exists() else {}
        budget = {"searches": 300}

        def fallback(name: str):
            key = name.lower()
            if key in cache:
                return cache[key]
            if args.replay or budget["searches"] <= 0:
                return None
            budget["searches"] -= 1
            cache[key] = github.search_name(name)
            return cache[key]
        resolver = Resolver([{"full_name": r["full_name"], "stars": r["stars"]} for r in repos], semantic=semantic, fallback=fallback)
        out, review = [], []
        hist = {r["url"]: r for r in disc["reels"]}
        recheck = (TODAY - timedelta(days=REMATCH_DAYS)).isoformat()
        for reel in reels_in:
            rec = reel.model_dump()
            h = hist.get(reel.url)
            m = (h or {}).get("match")
            # Matches are cached on the history row: a repo already in the catalog is final; "no repo" is retried weekly.
            cached = bool(m and ((m.get("repo") or "").lower() in index or (not m.get("repo") and (m.get("on") or "") >= recheck)))
            if cached:
                rec.update(repo=m.get("repo"), confidence=m.get("confidence", 0), method=m.get("method"))
            elif reel.repo:
                rec.update(repo=reel.repo, confidence=1.0, method="manual")
            elif reel.caption or reel.url in ocr_text:
                ms = resolver.resolve(reel.caption) if reel.caption else []
                if not (ms and ms[0].confidence >= MATCH_ACCEPT) and reel.url in ocr_text:
                    # Cover text is noisy: only explicit names (github.com/owner/name, owner/name) count.
                    explicit = " ".join(f"github.com/{c.owner}/{c.text}" for c in extract(ocr_text[reel.url]) if c.kind in ("url", "owner_repo"))
                    ms = sorted(ms + (resolver.resolve(explicit) if explicit else []), key=lambda m: -m.confidence)
                top = ms[0] if ms else None
                if top and top.confidence >= MATCH_ACCEPT:
                    rec.update(repo=top.full_name, confidence=top.confidence, method=top.method, evidence=top.evidence)
                else:
                    rec.update(repo=None, confidence=top.confidence if top else 0, method=top.method if top else None)
                    if top and top.confidence >= MATCH_REVIEW and reel.url not in discovered_urls:
                        review.append({"url": reel.url, "candidate": top.full_name, "confidence": top.confidence, "evidence": top.evidence})
            else:
                rec.update(repo=None, confidence=0, method=None)
            if h is not None and not cached:
                h["match"] = {"repo": rec.get("repo"), "confidence": rec.get("confidence", 0), "method": rec.get("method"), "on": TODAY.isoformat()}
            i = index.get((rec.get("repo") or "").lower())
            rec["repo_ok"] = None if rec.get("repo") is None else bool(i is not None and not repos[i]["archived"] and health(repos[i]) >= 0.4)
            out.append(rec)
        cache_path.write_text(json.dumps(cache, indent=0, sort_keys=True))
        return out, review
    reels, review = run.stage("match · reels → repos", _match)
    run.rows(reels=len(reels), matched=sum(1 for r in reels if r.get("repo")), review_queue=len(review))

    # Repos named in reels but missing from the catalog: fetch, embed and add them.
    def _extend():
        missing = sorted({r["repo"] for r in reels if r.get("repo") and r["repo"].lower() not in index})
        added = github.lookup(missing) if missing and not args.replay else []
        nonlocal_vecs = None
        if added:
            for a in added:
                a["topics"] = list(a.get("topics") or [])
                a["excerpt"] = clean_readme(a.get("readme") or "", 600)
                repos.append(a)
            nonlocal_vecs = embed([f"{a['full_name'].split('/')[1].replace('-', ' ')}. {a['description']}. Topics: {', '.join(a['topics'])}. {clean_readme(a.get('readme') or '', 1200)}" for a in added])
            for i, a in enumerate(added):
                index[a["full_name"].lower()] = len(repos) - len(added) + i
        for r in reels:  # canonical casing + reject unresolvable references
            i = index.get((r.get("repo") or "").lower())
            if i is not None:
                r["repo"] = repos[i]["full_name"]
                r["repo_ok"] = bool(not repos[i]["archived"] and health(repos[i]) >= 0.4)
            elif r.get("repo"):
                review.append({"url": r["url"], "candidate": r["repo"], "confidence": r["confidence"], "evidence": {"reason": "repository not resolved"}})
                r.update(repo=None, repo_ok=None)
        return added, nonlocal_vecs
    added, extra_vecs = run.stage("extend · repos found in reels", _extend)
    if extra_vecs is not None:
        vecs = np.vstack([vecs, extra_vecs])
    run.rows(added=len(added))

    # Creators: curated ones plus every author of a matched repo reel; fill follower counts (free paths first).
    def _creators():
        known = {c.handle for c in creators_in}
        counts: dict[str, int] = {}
        for r in reels:
            if r["creator"]:
                counts[r["creator"]] = counts.get(r["creator"], 0) + bool(r.get("repo"))
        for h, n in counts.items():
            disc["creators"].setdefault(h, {"followers": None})["repo_reels"] = n
        filled = 0 if args.replay else auto.fill_followers(disc["creators"], sorted(counts, key=lambda h: -counts[h]), TODAY)
        auto.save(disc["reels"], disc["creators"], disc.get("rejected"))
        for h in counts:
            if h not in known:
                c = disc["creators"][h]
                creators_in.append(curated.Creator(handle=h, followers=c.get("followers"), niche="auto-discovered", source="auto"))
        return filled
    filled = run.stage("creators · discover & vet", _creators)
    run.rows(creators=len(creators_in), followers_filled=filled)
    # Every discovered reel already passed the English + about-a-repo check; unresolved ones are shown too
    # (the browser says the repo isn't named) because they still answer searches by caption.

    # 8. scores
    def _score():
        hist = history_for(HISTORY)
        trust = {c.handle: creator_trust(c.model_dump(), reels, TODAY) for c in creators_in}
        trusted_reels: dict[str, int] = {}
        for rl in reels:
            if rl.get("repo") and trust.get(rl["creator"], {}).get("eligible"):
                trusted_reels[rl["repo"].lower()] = trusted_reels.get(rl["repo"].lower(), 0) + 1
        for r in repos:
            mo = momentum(r["stars"], [(d, s) for d, s in hist.get(r["repo_id"], []) if d < TODAY], r["created_at"], TODAY)
            h = hn_hits.get(r["full_name"].lower())
            r["mo"] = mo
            r["hn"] = {"count": h["count"], "points": h["points"], "url": h["top_url"], "title": h["top_title"]} if h else None
            r["ai"] = ai_compat(r)
            r["cat"] = sorted(set(cats.get(r["full_name"].lower(), [])) | {c for c, ws in CATEGORY_WORDS.items() if any(w in (r["description"] + " " + " ".join(r["topics"])).lower() for w in ws)})
            social = 0.6 * math.log1p(h["points"] if h else 0) / math.log1p(2000) + 0.4 * min(1.0, trusted_reels.get(r["full_name"].lower(), 0) / 3)
            r["sc"] = {"health": health(r), "momentum": momentum_score(mo, r["stars"]), "social": round(min(1.0, social), 3), "fresh": round(math.exp(-_days(r["pushed_at"]) / 60), 3)}
        return trust
    trust = run.stage("score · health, momentum, trust", _score)
    run.rows(repos=len(repos), creators=len(trust), eligible_creators=sum(1 for t in trust.values() if t["eligible"]))

    # 9. quality gate
    prev = json.loads((GOLD / "catalog.json").read_text()).get("count", 0) if (GOLD / "catalog.json").exists() else 0
    checks = run.stage("quality · checks", qa.run, repos, int(vecs.shape[0]), reels, [t for t in trust.values()], prev)
    run.rows(passed=sum(c["status"] == "pass" for c in checks), warnings=sum(c["status"] == "warn" for c in checks), failed=sum(c["status"] == "fail" for c in checks))

    # 10. retrieval evaluation on golden queries
    def _eval():
        bm = BM25([tokens(search_text(r)) for r in repos])
        rows = []
        for g in golden:
            qv = embed([g.query])[0]
            top = [repos[i]["full_name"].lower() for i, _ in rank(g.query, qv, repos, vecs, bm, k=10)]
            exp = [e.lower() for e in g.expect if e.lower() in index]
            if not exp:
                continue
            ranks = [top.index(e) + 1 for e in exp if e in top]
            first = min(ranks) if ranks else None
            rows.append({"query": g.query, "expect": g.expect, "first_hit": first, "top3": top[:3]})
        n = max(1, len(rows))
        return {"queries": len(rows), "hit1": round(sum(1 for r in rows if r["first_hit"] == 1) / n, 3),
                "hit3": round(sum(1 for r in rows if r["first_hit"] and r["first_hit"] <= 3) / n, 3),
                "mrr": round(sum(1 / r["first_hit"] for r in rows if r["first_hit"]) / n, 3), "rows": rows}
    ev = run.stage("eval · golden queries", _eval)
    run.rows(queries=ev["queries"], hit1=ev["hit1"], hit3=ev["hit3"], mrr=ev["mrr"])

    if any(c["status"] == "fail" for c in checks):
        print("✗ quality checks failed; nothing published", file=sys.stderr)
        for c in checks:
            print(f"  [{c['status']}] {c['name']}: {c['detail']}", file=sys.stderr)
        return 1

    # 11. gold
    def _gold():
        GOLD.mkdir(parents=True, exist_ok=True)
        cat_repos = [{
            "n": r["full_name"], "d": r["description"][:280], "t": r["topics"], "l": r["language"], "lic": r["license"], "s": r["stars"], "f": r["forks"],
            "p": r["pushed_at"][:10], "c": r["created_at"][:10], "a": r["archived"], "hp": r["homepage"], "rel": (r["latest_release"] or "")[:10],
            "x": r["excerpt"][:420], "cat": r["cat"], "ai": r["ai"], "mo": r["mo"], "hn": r["hn"], "sc": r["sc"],
        } for r in repos]
        (GOLD / "catalog.json").write_text(json.dumps({"generated": datetime.now(timezone.utc).isoformat(timespec="seconds"), "count": len(repos), "dims": int(vecs.shape[1]), "repos": cat_repos}, separators=(",", ":")))
        (GOLD / "embeddings.i8").write_bytes(quantize(vecs).tobytes())
        (GOLD / "creators.json").write_text(json.dumps({"creators": sorted(trust.values(), key=lambda t: -t["trust"]),
            "gates": {"min_followers": CREATOR_MIN_FOLLOWERS, "min_posts_60d": CREATOR_MIN_POSTS_60D}, "weights": TRUST_WEIGHTS}, indent=1))
        # Newest first, a few per repo, capped so the browser download stays reasonable.
        per_repo: dict[str, int] = {}
        shown = []
        for r in sorted(reels, key=lambda r: str(r["posted"]), reverse=True):
            k = (r.get("repo") or "").lower()
            if k and per_repo.get(k, 0) >= REELS_PER_REPO_MAX:
                continue
            per_repo[k] = per_repo.get(k, 0) + 1
            shown.append(r)
            if len(shown) >= REELS_PUBLISH_MAX:
                break
        keys = ("url", "creator", "posted", "repo", "confidence", "method", "likes", "comments", "views")
        compact = lambda r: {k: r.get(k) for k in keys if r.get(k) is not None} | {"repo": r.get("repo"), "caption": (r.get("caption") or "")[:300]}  # noqa: E731
        rows = [compact(r) for r in shown]
        # Every repo's reels (up to REELS_PER_REPO_SHARD, newest first) in 256 small files the browser loads on demand.
        shards: dict[str, dict[str, list]] = {}
        for r in sorted(reels, key=lambda r: str(r["posted"]), reverse=True):
            if r.get("repo"):
                bucket = shards.setdefault(shard_key(r["repo"]), {}).setdefault(r["repo"].lower(), [])
                if len(bucket) < REELS_PER_REPO_SHARD:
                    bucket.append(compact(r))
        shard_dir = GOLD / "reels"
        shard_dir.mkdir(exist_ok=True)
        for key in (f"{i:02x}" for i in range(256)):  # all buckets exist (empty = {}), so the browser never sees a 404
            (shard_dir / f"{key}.json").write_text(json.dumps(shards.get(key, {}), separators=(",", ":"), default=str))
        (GOLD / "reels.json").write_text(json.dumps({"reels": rows, "review": review}, separators=(",", ":"), default=str))
        # One int8 row per published reel (caption + the repo it covers), in reels.json order: binary, not base64.
        (GOLD / "reel_vecs.i8").write_bytes(quantize(embed([reel_text(r) for r in shown])).tobytes() if shown else b"")
        (GOLD / "discovery.json").write_text(json.dumps({"stats": disc["stats"], "history_reels": len(disc["reels"]), "shown_reels": len(shown),
                                                         "matched_reels": sum(1 for r in shown if r.get("repo"))}, indent=1, default=str))
        (GOLD / "ranking.json").write_text(json.dumps({"weights": RANK_WEIGHTS, "ai": AI_COMPAT, "platforms": PLATFORMS, "languages": LANGUAGES, "categories": CATEGORY_WORDS,
            "labels": {k: v["label"] for k, v in CATEGORIES.items()}}, indent=1))
        return len(cat_repos)

    def reel_text(r: dict) -> str:
        i = index.get((r.get("repo") or "").lower())
        repo = repos[i] if i is not None else None
        parts = [r.get("caption") or ""]
        if repo:
            parts += [repo["full_name"].split("/")[1].replace("-", " "), repo["description"], " ".join(repo["topics"])]
        return ". ".join(p for p in parts if p)
    n = run.stage("gold · publish site data", _gold)
    run.rows(files=7, repos=n)

    # run summary (last 30 runs kept)
    runs_path = HISTORY / "runs.json"
    runs = json.loads(runs_path.read_text()) if runs_path.exists() else []
    summary = {"finished": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seconds": round(time.time() - run.started, 1), "stages": run.stages, "checks": checks,
               "eval": {k: v for k, v in ev.items()}, "catalog": len(repos), "snapshot_days": counts["snapshot_days"]}
    runs = (runs + [{k: summary[k] for k in ("finished", "seconds", "catalog")} | {"failed": 0}])[-30:]
    runs_path.write_text(json.dumps(runs, indent=1))
    (GOLD / "pipeline.json").write_text(json.dumps({"last": summary, "history": runs}, indent=1, default=str))
    print(f"✓ done in {summary['seconds']}s · {len(repos)} repos · eval hit@3 {ev['hit3']} MRR {ev['mrr']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
