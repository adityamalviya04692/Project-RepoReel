"""GitHub source: discovery through the Search API, enrichment through batched GraphQL."""
from __future__ import annotations

import time
from typing import Iterable, Optional

from ..config import CATEGORIES, SEARCH_PAGES
from ..http import gh_headers, request

SEARCH = "https://api.github.com/search/repositories"
GRAPHQL = "https://api.github.com/graphql"


def discover(log=print) -> dict[str, dict]:
    """Runs every category query. Returns node_id → {full_name, categories, source}."""
    found: dict[str, dict] = {}
    for cat, spec in CATEGORIES.items():
        for q in spec["queries"]:
            for page in range(1, SEARCH_PAGES + 1):
                r = request("GET", SEARCH, headers=gh_headers(), params={"q": q, "sort": "stars", "order": "desc", "per_page": 100, "page": page})
                if r.status_code == 422:  # query beyond the 1,000-result window or invalid
                    break
                r.raise_for_status()
                items = r.json().get("items", [])
                for it in items:
                    rec = found.setdefault(it["node_id"], {"full_name": it["full_name"], "categories": set(), "source": "search"})
                    rec["categories"].add(cat)
                time.sleep(2.2)  # search API: 30 requests/minute
                if len(items) < 100:
                    break
        log(f"  discover {cat:<12} catalog size {len(found)}")
    return found


_FIELDS = """
  ... on Repository {
    id nameWithOwner description url homepageUrl stargazerCount forkCount isArchived isFork
    createdAt pushedAt
    primaryLanguage { name }
    licenseInfo { spdxId }
    repositoryTopics(first: 12) { nodes { topic { name } } }
    openIssues: issues(states: OPEN) { totalCount }
    latestRelease { publishedAt }
    r1: object(expression: "HEAD:README.md") { ... on Blob { text } }
    r2: object(expression: "HEAD:readme.md") { ... on Blob { text } }
    r3: object(expression: "HEAD:README.rst") { ... on Blob { text } }
  }
"""


def _flatten(n: dict) -> dict:
    readme = next((x["text"] for x in (n.get("r1"), n.get("r2"), n.get("r3")) if x and x.get("text")), "") or ""
    return {
        "repo_id": n["id"],
        "full_name": n["nameWithOwner"],
        "description": n.get("description") or "",
        "url": n["url"],
        "homepage": n.get("homepageUrl") or "",
        "stars": n["stargazerCount"],
        "forks": n["forkCount"],
        "archived": n["isArchived"],
        "fork": n["isFork"],
        "created_at": n["createdAt"],
        "pushed_at": n["pushedAt"],
        "language": (n.get("primaryLanguage") or {}).get("name") or "",
        "license": (n.get("licenseInfo") or {}).get("spdxId") or "",
        "topics": [t["topic"]["name"] for t in (n.get("repositoryTopics") or {}).get("nodes", [])],
        "open_issues": (n.get("openIssues") or {}).get("totalCount", 0),
        "latest_release": (n.get("latestRelease") or {}).get("publishedAt") or "",
        "readme": readme[:12000],
    }


def _graphql(query: str, variables: dict) -> dict:
    r = request("POST", GRAPHQL, headers=gh_headers(), json={"query": query, "variables": variables})
    r.raise_for_status()
    body = r.json()
    if body.get("errors") and not body.get("data"):
        raise RuntimeError(body["errors"][0].get("message"))
    return body.get("data") or {}


def enrich(node_ids: Iterable[str], batch: int = 40, log=print) -> list[dict]:
    """Full metadata and README for each repo, 40 per GraphQL call."""
    ids = list(node_ids)
    out: list[dict] = []
    q = f"query($ids: [ID!]!) {{ nodes(ids: $ids) {{ {_FIELDS} }} }}"
    for i in range(0, len(ids), batch):
        data = _graphql(q, {"ids": ids[i : i + batch]})
        out.extend(_flatten(n) for n in data.get("nodes", []) if n)
        if (i // batch) % 10 == 0:
            log(f"  enrich {min(i + batch, len(ids))}/{len(ids)}")
    return out


def lookup(full_names: Iterable[str]) -> list[dict]:
    """Enriches repos known only by name (from Hacker News or curated reels). Missing repos are skipped."""
    names = [n for n in dict.fromkeys(full_names) if "/" in n]
    out: list[dict] = []
    for i in range(0, len(names), 25):
        parts = []
        for j, name in enumerate(names[i : i + 25]):
            owner, repo = name.split("/", 1)
            parts.append(f'r{j}: repository(owner: {owner!r}, name: {repo!r}) {{ {_FIELDS} }}'.replace("'", '"'))
        try:
            data = _graphql("query { " + " ".join(parts) + " }", {})
        except RuntimeError:
            data = {}
        out.extend(_flatten(v) for v in data.values() if v)
    return out


def search_name(name: str) -> Optional[dict]:
    """Best repository whose name matches `name` (used by the matcher as a fallback)."""
    r = request("GET", SEARCH, headers=gh_headers(), params={"q": f"{name} in:name", "sort": "stars", "per_page": 5})
    if r.status_code != 200:
        return None
    items = r.json().get("items", [])
    time.sleep(2.2)
    return {"full_name": items[0]["full_name"], "stars": items[0]["stargazers_count"]} if items else None
