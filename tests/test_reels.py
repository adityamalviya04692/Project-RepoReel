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


def test_merge_dedupes_updates_and_expires():
    today = date(2026, 10, 23)
    old = [{"shortcode": "A", "posted": "2026-10-20", "views": 100, "first_seen": "2026-10-20"}, {"shortcode": "Z", "posted": "2026-05-01", "first_seen": "2026-05-01"}]
    out = auto.merge(old, [{"shortcode": "A", "posted": "2026-10-20", "views": 500}, {"shortcode": "B", "posted": "2026-10-22"}], today, keep_days=120)
    by = {r["shortcode"]: r for r in out}
    assert set(by) == {"A", "B"}  # Z expired
    assert by["A"]["views"] == 500 and by["A"]["first_seen"] == "2026-10-20"
    assert by["B"]["first_seen"] == "2026-10-23"


def test_budget_guard_stays_inside_free_credit():
    assert apify.budget_ok({"used": 1.2, "plan_cap": 5, "resets": None}, cap=4.5)
    assert not apify.budget_ok({"used": 4.4, "plan_cap": 5, "resets": None}, cap=4.5)
    assert not apify.budget_ok(None)


def test_discover_without_tokens_is_a_no_op(tmp_path, monkeypatch):
    monkeypatch.setattr(auto, "REELS_FILE", tmp_path / "reels.json")
    monkeypatch.setattr(auto, "CREATORS_FILE", tmp_path / "creators.json")
    monkeypatch.setattr(auto, "APIFY_TOKEN", "")
    monkeypatch.setattr(auto.instagram_graph, "configured", lambda: False)
    out = auto.discover(date(2026, 10, 23), log=lambda _: None)
    assert out["reels"] == [] and out["stats"]["apify"] == "not configured"
