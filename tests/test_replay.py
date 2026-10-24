"""Replay must remain offline even with provider credentials configured."""
import json
from datetime import date

import numpy as np
import pytest

from pipeline import cli
from pipeline.sources.curated import Creator, Reel


@pytest.mark.parametrize('with_discovery_snapshot', [False, True])
def test_replay_never_contacts_sources(tmp_path, monkeypatch, with_discovery_snapshot):
    today = date(2026, 10, 23)
    bronze = tmp_path / 'bronze' / today.isoformat()
    bronze.mkdir(parents=True)
    history = tmp_path / 'history'
    history.mkdir()
    gold = tmp_path / 'gold'
    rows = [{
        'repo_id': f'id{i}', 'full_name': f'owner/repo{i}', 'description': 'A useful tool',
        'url': f'https://github.com/owner/repo{i}', 'homepage': '', 'stars': 100 + i,
        'forks': 1, 'archived': False, 'fork': False, 'created_at': '2025-01-01T00:00:00Z',
        'pushed_at': '2026-10-22T00:00:00Z', 'language': 'Python', 'license': 'MIT',
        'topics': ['automation'], 'open_issues': 0, 'latest_release': '', 'readme': 'A working tool.'
    } for i in range(101)]
    (bronze / 'gh_search_hits.jsonl').write_text('')
    (bronze / 'hn_hits.jsonl').write_text('')
    (bronze / 'gh_repo_graphql.jsonl').write_text('\n'.join(json.dumps(r) for r in rows))
    if with_discovery_snapshot:
        (bronze / 'reels_discovered.jsonl').write_text(json.dumps({
            'url': 'https://www.instagram.com/reel/Test123/', 'creator': 'tester',
            'shortcode': 'Test123', 'posted': '2026-10-22', 'caption': 'This open-source tool is great, the code is at github.com/missing/tool'
        }) + '\n')
    for name, value in [('TODAY', today), ('BRONZE', tmp_path / 'bronze'), ('HISTORY', history), ('GOLD', gold), ('GITHUB_TOKEN', 'configured')]:
        monkeypatch.setattr(cli, name, value)
    monkeypatch.setattr(cli.auto, 'HISTORY', history)
    monkeypatch.setattr(cli.auto, 'REELS_FILE', history / 'reels.json')
    monkeypatch.setattr(cli.auto, 'CREATORS_FILE', history / 'creators.json')
    def forbidden(*a, **kw):
        raise AssertionError('replay attempted an external API call')
    for source, names in [(cli.github, ['lookup', 'search_name', 'discover', 'enrich']),
                          (cli.auto, ['discover', 'fill_followers'])]:
        for name in names:
            monkeypatch.setattr(source, name, forbidden)
    monkeypatch.setattr(cli.curated, 'creators', lambda: [Creator(handle='tester')])
    monkeypatch.setattr(cli.curated, 'reels', lambda: [Reel(url='https://www.instagram.com/reel/Manual123/', creator='tester', posted=today, repo='missing/manual')])
    monkeypatch.setattr(cli.curated, 'golden', lambda: [])
    monkeypatch.setattr(cli, 'embed', lambda texts: np.tile(np.array([1.] + [0.] * 383, dtype=np.float32), (len(texts), 1)))
    assert cli.main(['run', '--replay']) == 0
    report = json.loads((gold / 'discovery.json').read_text())
    assert report['stats']['replay'] is True
    assert report['stats']['apify'] == 'not called (replay)'
    if with_discovery_snapshot:  # the match is cached on the history row, so tomorrow's run skips it
        assert cli.auto.load_history()[0]['match']['on'] == today.isoformat()
    published = json.loads((gold / 'reels.json').read_text())
    assert all(r['repo'] is None for r in published['reels'])
    assert any(r['candidate'] == 'missing/manual' for r in published['review'])
