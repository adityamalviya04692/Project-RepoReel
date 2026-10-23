"""Bronze → silver with DuckDB SQL: typed, deduplicated tables written as Parquet."""
from __future__ import annotations

from pathlib import Path

import duckdb


def silver(bronze: Path, out: Path, history: Path, today: str) -> dict[str, int]:
    out.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    con.execute(f"""
        CREATE TABLE repos AS
        SELECT * EXCLUDE (rn) FROM (
          SELECT *, row_number() OVER (PARTITION BY repo_id ORDER BY stars DESC) AS rn
          FROM read_json_auto('{bronze / "gh_repo_graphql.jsonl"}', format='newline_delimited')
        ) WHERE rn = 1 AND NOT fork
    """)
    con.execute(f"COPY repos TO '{out / 'repos.parquet'}' (FORMAT parquet)")

    # Snapshots: append today's stars, keep 180 days of history, one row per repo per day.
    snap = history / "snapshots.parquet"
    con.execute(f"""
        CREATE TABLE today AS SELECT DATE '{today}' AS snapshot_date, repo_id, full_name, stars, forks, open_issues FROM repos
    """)
    if snap.exists():
        con.execute(f"""
            CREATE TABLE snapshots AS
            SELECT * FROM read_parquet('{snap}') WHERE snapshot_date <> DATE '{today}' AND snapshot_date >= DATE '{today}' - INTERVAL 180 DAY
            UNION ALL SELECT * FROM today
        """)
    else:
        con.execute("CREATE TABLE snapshots AS SELECT * FROM today")
    con.execute(f"COPY (SELECT * FROM snapshots ORDER BY repo_id, snapshot_date) TO '{snap}' (FORMAT parquet)")

    counts = {
        "repos": con.execute("SELECT count(*) FROM repos").fetchone()[0],
        "snapshots": con.execute("SELECT count(*) FROM snapshots").fetchone()[0],
        "snapshot_days": con.execute("SELECT count(DISTINCT snapshot_date) FROM snapshots").fetchone()[0],
    }
    con.close()
    return counts


def history_for(history: Path) -> dict[str, list]:
    """repo_id → [(date, stars), …] ascending, from the persisted snapshot table."""
    snap = history / "snapshots.parquet"
    if not snap.exists():
        return {}
    con = duckdb.connect()
    rows = con.execute(f"SELECT repo_id, snapshot_date, stars FROM read_parquet('{snap}') ORDER BY repo_id, snapshot_date").fetchall()
    con.close()
    out: dict[str, list] = {}
    for rid, d, s in rows:
        out.setdefault(rid, []).append((d, s))
    return out
