import pytest

from pipeline import reels as auto


@pytest.fixture(autouse=True)
def _history_in_tmp(tmp_path, monkeypatch):
    """No test may read or write the real data/history files (a test once overwrote the creator registry)."""
    for name in ("REELS_FILE", "CREATORS_FILE", "REJECTED_FILE", "HASHTAGS_FILE"):
        monkeypatch.setattr(auto, name, tmp_path / "_isolated_history" / f"{name.lower()}.json")
    (tmp_path / "_isolated_history").mkdir()
