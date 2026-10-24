from datetime import date

from pipeline import reels as auto
from pipeline.sources import apify

# Shaped like apify/instagram-hashtag-scraper output (synthetic test data, never published).
APIFY_ITEM = {
    "shortCode": "Cx1AbCdEf", "ownerUsername": "Some.Creator", "productType": "clips", "type": "Video",
    "timestamp": "2026-10-20T09:15:00.000Z", "caption": "This repo lets AI control your browser 🤯 github.com/browser-use/browser-use #aitools",
    "likesCount": 5400, "commentsCount": 210, "videoPlayCount": 98000, "hashtags": ["aitools"], "mentions": [],
}


def test_topics_rotate_and_cover_everything():
    topics = [{"q": str(i), "kind": "hashtag"} for i in range(10)]
    seen = set()
    for d in range(5):
        picked = auto.pick_topics(date(2026, 10, 1 + d), topics, n=2)
        assert len(picked) == 2
        seen |= {t["q"] for t in picked}
    assert seen == {str(i) for i in range(10)}


def test_normalize_apify_reel():
    r = auto.normalize_apify(APIFY_ITEM, "aitools")
    assert r["url"] == "https://www.instagram.com/reel/Cx1AbCdEf/"
    assert (r["creator"], r["posted"], r["views"], r["source"]) == ("some.creator", "2026-10-20", 98000, "apify:aitools")
    assert auto.normalize_apify({**APIFY_ITEM, "likesCount": -1}, "x")["likes"] is None  # hidden likes
    assert auto.normalize_apify({**APIFY_ITEM, "productType": "feed", "type": "Image"}, "x") is None  # not a reel


def test_normalize_graph_media():
    m = {"permalink": "https://www.instagram.com/reel/AbC123/", "media_product_type": "REELS", "timestamp": "2026-10-21T10:00:00+0000", "caption": "repo", "like_count": 9, "comments_count": 1}
    r = auto.normalize_graph("Dev.Tools", m)
    assert r["shortcode"] == "AbC123" and r["creator"] == "dev.tools" and r["posted"] == "2026-10-21"
    assert auto.normalize_graph("x", {**m, "media_product_type": "FEED", "media_type": "IMAGE"}) is None


def test_merge_dedupes_updates_and_keeps_repo_reels():
    today = date(2026, 10, 23)
    old = [{"shortcode": "A", "posted": "2026-10-20", "views": 100, "first_seen": "2026-10-20"}, {"shortcode": "Z", "posted": "2025-05-01", "first_seen": "2025-05-01"}]
    out = auto.merge(old, [{"shortcode": "A", "posted": "2026-10-20", "views": 500, "thumb": "https://x"}, {"shortcode": "B", "posted": "2026-10-22"}], today)
    by = {r["shortcode"]: r for r in out}
    assert set(by) == {"A", "B", "Z"}  # repo reels never expire
    assert by["A"]["views"] == 500 and by["A"]["first_seen"] == "2026-10-20" and "thumb" not in by["A"]
    assert by["B"]["first_seen"] == "2026-10-23"
    assert [r["shortcode"] for r in out] == ["B", "A", "Z"]


def test_budget_guard_stays_inside_free_credit():
    assert apify.budget_ok({"used": 1.2, "plan_cap": 5, "resets": None}, cap=4.5)
    assert not apify.budget_ok({"used": 4.4, "plan_cap": 5, "resets": None}, cap=4.5)
    assert not apify.budget_ok(None)


def isolate(tmp_path, monkeypatch):
    for name in ("REELS_FILE", "CREATORS_FILE", "REJECTED_FILE", "HASHTAGS_FILE"):
        monkeypatch.setattr(auto, name, tmp_path / f"{name.lower()}.json")
    monkeypatch.setattr(auto.ocr, "available", lambda: False)


def test_discover_without_tokens_is_a_no_op(tmp_path, monkeypatch):
    isolate(tmp_path, monkeypatch)
    monkeypatch.setattr(auto, "APIFY_TOKEN", "")
    monkeypatch.setattr(auto.instagram_graph, "configured", lambda: False)
    out = auto.discover(date(2026, 10, 23), log=lambda _: None)
    assert out["reels"] == [] and out["stats"]["apify"] == "not configured"


def test_budget_rejects_invalid_and_lower_account_limits():
    for u in ({"used": 0, "plan_cap": 0}, {"used": float('nan'), "plan_cap": 5},
              {"used": -1, "plan_cap": 5}, {"used": 1, "plan_cap": 1.1}, {}):
        assert not apify.budget_ok(u)


def test_usage_fails_closed_on_incomplete_or_unavailable_data(monkeypatch):
    import httpx
    class Response:
        status_code = 200
        def json(self):
            return {"data": {"current": {}, "limits": {}}}
    monkeypatch.setattr(apify, 'request', lambda *a, **kw: Response())
    assert apify.usage('test-token') is None
    def fail(*a, **kw):
        raise httpx.ConnectError('unavailable')
    monkeypatch.setattr(apify, 'request', fail)
    assert apify.usage('test-token') is None


def test_actor_rechecks_budget_caps_cost_and_does_not_retry(monkeypatch):
    import pytest
    calls = []
    monkeypatch.setattr(apify, 'usage', lambda token: {"used": 1, "plan_cap": 5})
    class Response:
        status_code = 200
        def json(self):
            return [APIFY_ITEM]
    monkeypatch.setattr(apify, 'request', lambda *a, **kw: calls.append((a, kw)) or Response())
    assert apify.run_actor('actor', {}, token='test-token') == [APIFY_ITEM]
    args, kw = calls[0]
    assert kw['retries'] == 0
    assert kw['params']['maxTotalChargeUsd'] == 0.25
    assert 'token' not in kw['params']
    monkeypatch.setattr(apify, 'usage', lambda token: None)
    with pytest.raises(RuntimeError, match='budget'):
        apify.run_actor('actor', {}, token='test-token')
    assert len(calls) == 1


def test_discovery_reports_all_provider_failures(tmp_path, monkeypatch):
    isolate(tmp_path, monkeypatch)
    monkeypatch.setattr(auto, 'APIFY_TOKEN', 'test-token')
    monkeypatch.setattr(auto.instagram_graph, 'configured', lambda: False)
    monkeypatch.setattr(apify, 'usage', lambda: {"used": 0, "plan_cap": 5})
    def fail(*a):
        raise RuntimeError('HTTP 401')
    monkeypatch.setattr(apify, 'topic_reels', fail)
    out = auto.discover(date(2026, 10, 23), log=lambda _: None)
    assert out['stats']['apify'] == 'error: no topics completed'


def test_replay_without_discovery_snapshot_is_empty(tmp_path):
    assert auto._load_replay(tmp_path) == []


def test_missing_timestamp_is_not_invented():
    assert auto.normalize_apify({**APIFY_ITEM, 'timestamp': ''}, 'x') is None


def reel(code, owner, caption, ts="2026-10-20T09:00:00.000Z", **kw):
    return {**APIFY_ITEM, "shortCode": code, "ownerUsername": owner, "caption": caption, "timestamp": ts, **kw}


EN_REPO = "This GitHub repo lets your AI agent read any website for free. It is open source and you can run it locally."


def test_allowance_spreads_remaining_credit_over_the_cycle():
    u = {"used": 3.0, "plan_cap": 5, "resets": "2026-10-31T23:59:59.999Z"}
    assert apify.allowance(u, date(2026, 10, 22), cap=4.5) == 46  # (4.5 - 3.0 - 0.25) / 10 days / $0.0027
    assert apify.allowance({**u, "used": 4.4}, date(2026, 10, 22), cap=4.5) == 0
    assert apify.allowance(None, date(2026, 10, 22)) == 0


def test_repo_creators_feeds_are_read_and_rejects_remembered(tmp_path, monkeypatch):
    isolate(tmp_path, monkeypatch)
    monkeypatch.setattr(auto, "APIFY_TOKEN", "test-token")
    monkeypatch.setattr(auto.instagram_graph, "configured", lambda: False)
    monkeypatch.setattr(apify, "usage", lambda: {"used": 0, "plan_cap": 5, "resets": None})
    monkeypatch.setattr(apify, "topic_reels", lambda t, n: [
        reel("T1", "Dev.Maker", EN_REPO),
        reel("T2", "otra.cuenta", "Este repo de GitHub es increíble para la búsqueda de empleo con IA, de verdad que sí"),
    ])
    asked = []

    def feeds(users, per):
        asked.append(users)
        return [reel("F1", "dev.maker", "Comment REPO and I'll send you this open-source tool that turns any PDF into clean markdown for your LLM."),
                reel("F2", "dev.maker", "Day in my life as a software engineer in New York, with coffee and a lot of meetings today."),
                reel("T1", "dev.maker", EN_REPO, likesCount=9999)]
    monkeypatch.setattr(apify, "creator_reels", feeds)
    out = auto.discover(date(2026, 10, 23), log=lambda _: None)
    assert asked == [["dev.maker"]]  # found by a topic search, then its feed read in the same run
    assert [r["shortcode"] for r in out["reels"]] == ["T1", "F1"] or {r["shortcode"] for r in out["reels"]} == {"T1", "F1"}
    assert next(r for r in out["reels"] if r["shortcode"] == "T1")["likes"] == 9999  # refreshed stats
    assert {"T2", "F2"} <= out["rejected"]
    assert out["stats"]["rejected"] == {"not_english": 1, "off_topic": 1}
    assert out["stats"]["feeds"]["apify"] == 1 and out["stats"]["kept"] == 2
    auto.save(out["reels"], out["creators"], out["rejected"])
    again = auto.Discovery(date(2026, 10, 24), lambda _: None)
    assert again.absorb([auto.normalize_apify(reel("T2", "otra.cuenta", "x"), "t")]) == 0  # never judged twice
    assert auto.is_repo_creator(again.creators["dev.maker"])


def test_older_history_is_rejudged_under_current_rules(tmp_path, monkeypatch):
    isolate(tmp_path, monkeypatch)
    auto.save([{"shortcode": "ES1", "creator": "x", "posted": "2026-10-01", "caption": "¿Una IA dejaría morir a un gato solo por obedecer una orden? Mira el repo en GitHub"},
               {"shortcode": "EN1", "creator": "y", "posted": "2026-10-02", "caption": EN_REPO}], {})
    d = auto.Discovery(date(2026, 10, 23), lambda _: None)
    assert [r["shortcode"] for r in d.history] == ["EN1"] and "ES1" in d.rejected


def graph_fixture(monkeypatch, pages_by_user):
    """Fake Business Discovery: pages_by_user[username][cursor] = (media, next_cursor)."""
    g = auto.instagram_graph
    monkeypatch.setattr(g, "configured", lambda: True)
    monkeypatch.setattr(auto, "APIFY_TOKEN", "")
    monkeypatch.setattr(g, "usage", {"calls": 0, "pct": 0.0, "error": "", "last": "ok"})
    monkeypatch.setattr(g, "hashtag_id", lambda tag: None)

    def bd(username, after=None, limit=30):
        g.usage["calls"] += 1
        if username not in pages_by_user:
            g.usage["last"] = "missing"
            return None
        g.usage["last"] = "ok"
        data, nxt = pages_by_user[username][after]
        return {"followers_count": 120000, "media": {"data": data, "paging": {"cursors": {"after": nxt}, **({"next": "more"} if nxt else {})}}}
    monkeypatch.setattr(g, "business_discovery", bd)
    return g


def media(code, ts, caption=EN_REPO):
    return {"permalink": f"https://www.instagram.com/reel/{code}/", "media_product_type": "REELS", "timestamp": ts, "caption": caption}


def test_graph_crawl_reads_whole_history_and_resumes(tmp_path, monkeypatch):
    isolate(tmp_path, monkeypatch)
    pages = {"dev.maker": {None: ([media("N1", "2026-10-22T10:00:00+0000")], "c1"),
                           "c1": ([media("O1", "2025-06-01T10:00:00+0000")], "c2"),
                           "c2": ([media("O2", "2023-03-01T10:00:00+0000")], None)}}
    graph_fixture(monkeypatch, pages)
    auto.save([{"shortcode": "S1", "creator": "dev.maker", "posted": "2026-10-01", "caption": EN_REPO}], {})
    monkeypatch.setattr(auto, "GRAPH_CALLS_PER_RUN", 2)
    out = auto.discover(date(2026, 10, 23), log=lambda _: None)
    assert {r["shortcode"] for r in out["reels"]} == {"S1", "N1", "O1"}
    g = out["creators"]["dev.maker"]["graph"]
    assert g["after"] == "c2" and not g["backfilled"] and out["creators"]["dev.maker"]["followers"] == 120000
    auto.save(out["reels"], out["creators"], out["rejected"])
    monkeypatch.setattr(auto, "GRAPH_CALLS_PER_RUN", 10)
    out = auto.discover(date(2026, 10, 24), log=lambda _: None)  # continues from the saved cursor; no age cutoff
    assert "O2" in {r["shortcode"] for r in out["reels"]} and out["creators"]["dev.maker"]["graph"]["backfilled"]
    assert out["stats"]["backfilled_creators"] == 1


def test_tagged_creators_are_probed_and_join_when_they_post_repos(tmp_path, monkeypatch):
    isolate(tmp_path, monkeypatch)
    pages = {"dev.maker": {None: ([media("A1", "2026-10-22T10:00:00+0000", EN_REPO + " Credit @Repo.Fan and @brand.co")], None)},
             "repo.fan": {None: ([media("B1", "2026-10-21T10:00:00+0000"), media("B2", "2026-10-20T10:00:00+0000")], "b2")},
             "repo.fan_older": {}}
    pages["repo.fan"]["b2"] = ([media("B3", "2025-01-01T10:00:00+0000")], None)
    graph_fixture(monkeypatch, pages)
    auto.save([{"shortcode": "S1", "creator": "dev.maker", "posted": "2026-10-01", "caption": EN_REPO}], {})
    out = auto.discover(date(2026, 10, 23), log=lambda _: None)
    cs = out["creators"]
    assert cs["repo.fan"]["probe"] == "done" and auto.is_repo_creator(cs["repo.fan"])
    assert cs["brand.co"]["probe"] == "done" and cs["brand.co"]["graph"]["status"] == "unavailable"  # not a business account
    assert {"A1", "B1", "B2", "B3"} <= {r["shortcode"] for r in out["reels"]}  # the new creator's history too


def test_crawl_pauses_for_the_hourly_window_and_stops_at_the_deadline(tmp_path, monkeypatch):
    isolate(tmp_path, monkeypatch)
    chain = {None: ([media("P0", "2026-10-22T10:00:00+0000")], "p1")}
    for i in range(1, 6):
        chain[f"p{i}"] = ([media(f"P{i}", f"2026-0{i}-01T10:00:00+0000")], f"p{i + 1}" if i < 5 else None)
    g = graph_fixture(monkeypatch, {"dev.maker": chain})
    real_bd = g.business_discovery

    def limited(username, after=None, limit=30):  # every 2nd call reports the hourly window as used up
        r = real_bd(username, after, limit)
        g.usage["pct"] = 80.0 if g.usage["calls"] % 2 == 0 else 10.0
        return r
    monkeypatch.setattr(g, "business_discovery", limited)
    clock = {"t": 0.0}
    monkeypatch.setattr(auto, "_now", lambda: clock["t"])
    monkeypatch.setattr(auto, "_sleep", lambda s: clock.__setitem__("t", clock["t"] + s))
    monkeypatch.setattr(auto, "CRAWL_MINUTES", 60)
    auto.save([{"shortcode": "S1", "creator": "dev.maker", "posted": "2026-10-01", "caption": EN_REPO}], {})
    out = auto.discover(date(2026, 10, 23), log=lambda _: None)
    assert out["stats"]["pauses"] >= 1 and clock["t"] <= 60 * 60
    assert {"P0", "P1", "P2"} <= {r["shortcode"] for r in out["reels"]}


def test_graph_usage_headers_stop_the_run_early():
    import httpx
    g = auto.instagram_graph
    saved = dict(g.usage)
    try:
        g.usage.update(calls=0, pct=0.0, error="")
        g._track(httpx.Response(200, headers={"x-app-usage": '{"call_count": 81, "total_cputime": 3, "total_time": 5}'}))
        assert g.usage["pct"] == 81 and not g.has_budget()
        g.usage.update(pct=0.0)
        g._track(httpx.Response(200, headers={"x-business-use-case-usage": '{"123": [{"type": "instagram", "call_count": 12, "total_cputime": 40, "total_time": 9}]}'}))
        assert g.usage["pct"] == 40 and g.has_budget()
    finally:
        g.usage.update(saved)


def test_ocr_only_for_reels_that_hide_the_repo():
    hidden = {"thumb": "https://scontent.cdninstagram.com/v/x.jpg", "caption": "Comment TOOL and I will send you this free open-source app for your laptop and phone"}
    assert auto.needs_ocr(hidden)
    assert not auto.needs_ocr({**hidden, "caption": hidden["caption"] + " github.com/acme/tool"})
    assert not auto.needs_ocr({**hidden, "thumb": ""})
    assert auto.ocr.read("https://evil.example.com/x.jpg") == ""  # only Instagram CDN covers are fetched


def test_history_is_sharded_by_month_and_legacy_file_migrated(tmp_path, monkeypatch):
    isolate(tmp_path, monkeypatch)
    import json
    auto.REELS_FILE.write_text(json.dumps([{"shortcode": "L1", "creator": "a", "posted": "2025-12-03", "caption": EN_REPO}]))
    rows = auto.load_history() + [{"shortcode": "N1", "creator": "a", "posted": "2026-10-20", "caption": EN_REPO, "thumb": "https://x"}]
    auto.save(rows, {})
    shards = sorted(p.name for p in (tmp_path / "reels").glob("*.json"))
    assert shards == ["2025-12.json", "2026-10.json"] and not auto.REELS_FILE.exists()
    assert [r["shortcode"] for r in auto.load_history()] == ["N1", "L1"]
    assert "thumb" not in auto.load_history()[0]
    auto.save([r for r in auto.load_history() if r["shortcode"] == "N1"], {})
    assert sorted(p.name for p in (tmp_path / "reels").glob("*.json")) == ["2026-10.json"]
