/* Types and loading for the static data the pipeline publishes (web/public/data). */

export interface Repo {
  n: string; // owner/name
  d: string; // description
  t: string[]; // topics
  l: string; // language
  lic: string;
  s: number; // stars
  f: number; // forks
  p: string; // pushed (YYYY-MM-DD)
  c: string; // created
  a: boolean; // archived
  hp: string;
  rel: string;
  x: string; // README excerpt
  cat: string[];
  ai: string[];
  mo: { d7: number | null; d30: number | null; est: boolean };
  hn: { count: number; points: number; url: string; title: string } | null;
  sc: { health: number; momentum: number; social: number; fresh: number; pop?: number };
}

export interface Creator {
  handle: string; followers: number; niche: string; reels: number; posts_60d: number;
  accuracy: number; consistency: number; engagement: number; recency: number; trust: number;
  eligible: boolean; badge: 'top' | 'verified' | 'pending'; reasons: string[]; source?: string;
}

export interface Reel {
  url: string; creator: string; posted: string; repo: string | null; confidence: number; method: string | null;
  likes?: number | null; comments?: number | null; views?: number | null; caption?: string;
  vec?: string; // base64 int8 384-d (caption + repo text), from the pipeline
}

export interface Ranking {
  weights: Record<'semantic' | 'keyword' | 'popularity' | 'momentum' | 'health' | 'social' | 'freshness', number>;
  ai: Record<string, string[]>;
  platforms: Record<string, string[]>;
  languages: Record<string, string>;
  categories: Record<string, string[]>;
  labels: Record<string, string>;
}

export interface Stage { name: string; seconds: number; rows?: Record<string, number> }
export interface Check { name: string; status: 'pass' | 'warn' | 'fail'; detail: string }
export interface Pipeline {
  last: {
    finished: string; seconds: number; catalog: number; snapshot_days: number; stages: Stage[]; checks: Check[];
    eval: { queries: number; hit1: number; hit3: number; mrr: number; rows: { query: string; expect: string[]; first_hit: number | null; top3: string[] }[] };
  };
  history: { finished: string; seconds: number; catalog: number }[];
}

export interface Discovery {
  stats: {
    apify: string; graph: string; graph_hashtags?: string; topics: { q: string; kind: string; reels: number; kept?: number }[]; fetched: number;
    budget: { used: number; plan_cap: number; resets: string | null } | null; replay?: boolean; resumed?: boolean;
    kept?: number; rejected?: { not_english: number; off_topic: number }; feeds?: { graph: number; apify: number }; ocr?: number;
    allowance?: number; repo_creators?: number; creators_seen?: number; history_pages?: number; pauses?: number; backfilled_creators?: number; candidates?: number;
  };
  history_reels: number;
  shown_reels: number;
  matched_reels?: number;
}

export interface Data {
  generated: string;
  repos: Repo[];
  vecs: Int8Array;
  reelVecs: Int8Array; // one row per reels.json entry (caption + repo), empty when not published
  dims: number;
  ranking: Ranking;
  creators: { creators: Creator[]; gates: { min_followers: number; min_posts_60d: number } };
  reels: { reels: Reel[]; review: { url: string; candidate: string; confidence: number }[] };
  pipeline: Pipeline | null;
  discovery: Discovery | null;
  byName: Map<string, number>;
  reelsByRepo: Map<string, Reel[]>;
  creatorByHandle: Map<string, Creator>;
}

const base = `${import.meta.env.BASE_URL}data/`;
const json = async <T,>(f: string): Promise<T> => {
  const r = await fetch(base + f);
  if (!r.ok) throw new Error(`${f}: ${r.status}`);
  return r.json();
};

/** Per-repo reel shard a repository lives in (FNV-1a, 256 buckets); pipeline/text.py shard_key() matches. */
export function shardKey(name: string): string {
  let h = 0x811c9dc5;
  for (const b of new TextEncoder().encode(name.toLowerCase())) h = Math.imul(h ^ b, 0x01000193) >>> 0;
  return (h & 0xff).toString(16).padStart(2, '0');
}

const shards = new Map<string, Promise<Record<string, Reel[]>>>();
/** Every published reel about one repo (newest first), loaded on demand from its shard. */
export function reelsForRepo(name: string): Promise<Reel[]> {
  const key = shardKey(name);
  if (!shards.has(key)) shards.set(key, json<Record<string, Reel[]>>(`reels/${key}.json`).catch(() => ({})));
  return shards.get(key)!.then((s) => s[name.toLowerCase()] ?? []);
}

let loading: Promise<Data> | null = null;

export function load(): Promise<Data> {
  return (loading ??= (async () => {
    const [catalog, vecBuf, reelVecBuf, ranking, creators, reels, pipeline, discovery] = await Promise.all([
      json<{ generated: string; dims: number; repos: Repo[] }>('catalog.json'),
      fetch(base + 'embeddings.i8').then((r) => r.arrayBuffer()),
      fetch(base + 'reel_vecs.i8').then((r) => (r.ok ? r.arrayBuffer() : new ArrayBuffer(0)), () => new ArrayBuffer(0)),
      json<Ranking>('ranking.json'),
      json<Data['creators']>('creators.json'),
      json<Data['reels']>('reels.json'),
      json<Pipeline>('pipeline.json').catch(() => null),
      json<Discovery>('discovery.json').catch(() => null),
    ]);
    const maxLog = Math.max(1, ...catalog.repos.map((r) => Math.log1p(r.s)));
    for (const r of catalog.repos) r.sc.pop = Math.log1p(r.s) / maxLog; // same as pipeline/rank.py
    ranking.weights.popularity ??= 0.1;
    const byName = new Map(catalog.repos.map((r, i) => [r.n.toLowerCase(), i]));
    const creatorByHandle = new Map(creators.creators.map((c) => [c.handle, c]));
    const reelsByRepo = new Map<string, Reel[]>();
    for (const rl of reels.reels) {
      if (!rl.repo) continue;
      const k = rl.repo.toLowerCase();
      reelsByRepo.set(k, [...(reelsByRepo.get(k) ?? []), rl]);
    }
    // Best reels first: trust × match confidence × recency.
    for (const [k, list] of reelsByRepo) {
      const score = (r: Reel) => (0.3 + (creatorByHandle.get(r.creator)?.trust ?? 0)) * r.confidence * Math.exp(-(Date.now() - Date.parse(r.posted)) / 864e5 / 45);
      reelsByRepo.set(k, [...list].sort((a, b) => score(b) - score(a)));
    }
    return { generated: catalog.generated, repos: catalog.repos, vecs: new Int8Array(vecBuf), reelVecs: new Int8Array(reelVecBuf), dims: catalog.dims, ranking, creators, reels, pipeline, discovery, byName, reelsByRepo, creatorByHandle };
  })());
}

/** Cosine-like similarity between a float query and an int8 row (rows are unit vectors × 127). */
export function dotRow(vecs: Int8Array, dims: number, row: number, q: Float32Array): number {
  let s = 0;
  const o = row * dims;
  for (let i = 0; i < dims; i++) s += vecs[o + i] * q[i];
  return s / 127;
}

export function rowVector(vecs: Int8Array, dims: number, row: number): Float32Array {
  const v = new Float32Array(dims);
  for (let i = 0; i < dims; i++) v[i] = vecs[row * dims + i] / 127;
  return v;
}
