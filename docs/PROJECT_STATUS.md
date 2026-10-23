# RepoReel implementation and operations

Reviewed 23 October 2026. Use this file and the source code for current behavior; `SPEC.md` also preserves the original design.

## What runs where

- `pipeline/cli.py` orchestrates discovery, enrichment, DuckDB transforms, MiniLM embeddings, caption matching, repository extension, creator scoring, quality checks, evaluation and static publication.
- GitHub Search and GraphQL supply the repository catalog; HN Algolia supplies an independent social signal. `curated/` holds optional manual reels, creators and 12 evaluation queries.
- `pipeline/reels.py` rotates four Instagram discovery topics per run, deduplicates by shortcode and keeps 120 days of history. Apify is optional; Meta Business Discovery is an optional source of follower counts and recent media for known creators.
- `data/bronze/YYYY-MM-DD/` contains raw JSONL, retained as a seven-day Actions artifact. DuckDB produces `data/silver/repos.parquet` and daily star history in `data/history/snapshots.parquet`. Matching and scoring happen in Python; the original specification's additional silver tables are not implemented.
- `web/public/data/` serves the catalog, int8 vectors, reels, creators, ranking configuration, discovery status and pipeline report. Quality failures prevent gold publication. Star snapshots and discovered history are persisted before that gate.
- `web/` is React/TypeScript on GitHub Pages. Queries use BM25 immediately and MiniLM in a worker once the model is available. Local reel additions appear immediately, with background embedding. Screenshots use client-side Tesseract OCR; extracted names resolve against the catalog and optionally GitHub.
- `worker/` is optional Cloudflare live search. It is separate from the static site and requires a KV namespace, an Apify secret and the `VITE_LIVE_URL` repository variable.

## Deployment and schedule

- `ci.yml` runs Python tests plus web tests/build on code changes.
- `pipeline.yml` runs daily at **08:45 Asia/Kolkata** and can be dispatched manually. It commits refreshed data to `main` and calls the reusable Pages workflow explicitly, because a push made with the Actions token does not itself trigger another push workflow.
- `deploy.yml` tests and builds the web app, uploads Pages output and deploys it. A successful push alone does not prove a live deployment.
- Repository: https://github.com/adityamalviya04692/Project-RepoReel
- Site: https://adityamalviya04692.github.io/Project-RepoReel/

## Completed continuation fixes

- Provider usage is validated before each paid actor launch, including creator profile lookups. Requests specify a $0.25 per-run charge cap and never retry paid launches automatically. Unknown usage blocks launches. Tokens travel in Authorization headers.
- Discovery reports partial or failed topic requests instead of always claiming success. Missing timestamps are not replaced with invented publication dates.
- Replay avoids all source API calls, even when credentials exist or no discovery snapshot was recorded. Model assets may still download if absent from cache.
- Unresolved repository references are moved to review; a quality check blocks orphan repository links.
- Reel additions no longer wait for model download before appearing. Items without a vector keep keyword relevance even after the query has a vector.
- Empty and creator states describe the implemented behavior and distinguish pending creators from earned badges.

## Remaining boundaries

- Apify and Meta configuration are independent. Meta credentials are optional and do not block Apify discovery.
- Monthly usage can be delayed; pipeline and optional Worker launches can overlap. KV counters do not provide an atomic global quota. Provider account spending limits are the final backstop; the code cannot promise zero cost.
- Creator badges use followers and posting frequency. The implementation does not verify professional/public account status or prove a creator's identity. Accuracy is a repository-health signal, not a semantic fact-check of every claim.
- Retrieval evaluation covers 12 repository queries, not reel-matching precision or all real user queries. Published metrics should be read as measured, without claiming perfect retrieval.
- Automatic deleted-post detection, opt-in frame/audio processing, MCP access and digests remain roadmap features. Local additions stay in the visitor's browser unless exported and committed manually.

## Recovering an interrupted run

GraphQL read responses are retried if their JSON/UTF-8 is truncated. Enrichment saves each completed batch atomically into bronze. In Actions, dispatch **Nightly data pipeline** with `resume_from_run` set to the failed run ID while its seven-day bronze artifact still exists. The workflow restores those files, skips repeated discovery requests and fetches only missing repository metadata. Creator lookups may still run behind the same spending guard. On older runs created before checkpointing, enrichment must start again, but the recorded topic results are reused.

Locally, `python -m pipeline.cli run --resume` resumes available bronze with GitHub credentials; `--replay` is the source-API-free rebuild path.
