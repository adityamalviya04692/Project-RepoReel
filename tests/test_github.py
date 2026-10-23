import json

import pytest

from pipeline.sources import github


def test_read_queries_retry_truncated_utf8(monkeypatch):
    calls = []
    class Response:
        def raise_for_status(self):
            pass
        def json(self):
            if len(calls) == 1:
                raise UnicodeDecodeError('utf-8', b'\xc3', 0, 1, 'truncated')
            return {'data': {'nodes': []}}
    monkeypatch.setattr(github, 'request', lambda *a, **kw: calls.append(kw) or Response())
    monkeypatch.setattr(github.time, 'sleep', lambda _: None)
    assert github._graphql('query { nodes { id } }', {}) == {'nodes': []}
    assert len(calls) == 2


def test_enrichment_resumes_completed_batches_after_failure(tmp_path, monkeypatch):
    checkpoint = tmp_path / 'gh_repo_graphql.jsonl'
    calls = []
    monkeypatch.setattr(github, '_flatten', lambda n: {'repo_id': n['id'], 'full_name': f"owner/{n['id']}"})
    def query(q, variables):
        calls.append(variables['ids'])
        if variables['ids'] == ['c', 'd']:
            raise RuntimeError('interrupted')
        return {'nodes': [{'id': rid} for rid in variables['ids']]}
    monkeypatch.setattr(github, '_graphql', query)
    with pytest.raises(RuntimeError, match='interrupted'):
        github.enrich(['a', 'b', 'c', 'd'], batch=2, checkpoint=checkpoint, log=lambda _: None)
    assert [json.loads(line)['repo_id'] for line in checkpoint.read_text().splitlines()] == ['a', 'b']
    calls.clear()
    monkeypatch.setattr(github, '_graphql', lambda q, variables: calls.append(variables['ids']) or {'nodes': [{'id': rid} for rid in variables['ids']]})
    out = github.enrich(['a', 'b', 'c', 'd'], batch=2, checkpoint=checkpoint, log=lambda _: None)
    assert calls == [['c', 'd']]
    assert [r['repo_id'] for r in out] == ['a', 'b', 'c', 'd']
