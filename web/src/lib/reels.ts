/* Reel-first search. A reel is the answer; the repo it covers is the supporting detail.
   Sources: curated reels from the pipeline (reels.json) and reels the visitor adds in this
   browser (localStorage). Ranking blends meaning, keywords, recency, creator trust and repo health. */

import { rowVector, type Data, type Reel, type Repo } from './data';
import { resolve } from './match';
import { BM25, tokens, understand } from './rank';

export interface ReelItem {
  key: string;
  url: string;
  shortcode: string;
  creator: string;
  posted: string;
  caption: string;
  repo: string | null;
  repoRow: number | undefined;
  source: 'curated' | 'local';
  verified: boolean;
  badge: 'top' | 'verified' | 'pending' | 'local' | 'live';
  trust: number;
  vec: Float32Array | null;
  likes?: number | null;
  comments?: number | null;
}

export interface ReelHit {
  item: ReelItem;
  score: number;
  relevance: number;
}

const LOCAL_KEY = 'reporeel-local-reels';
export const REEL_URL = /^https:\/\/(www\.)?instagram\.com\/(reel|reels|p)\/([A-Za-z0-9_-]+)/;

export interface LocalReel {
  url: string;
  creator: string;
  repo: string | null;
  caption: string;
  posted: string;
  added: string;
}

export function loadLocal(): LocalReel[] {
  try {
    const v = JSON.parse(localStorage.getItem(LOCAL_KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function saveLocal(list: LocalReel[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(list));
  } catch {
    /* private mode */
  }
}

export const normalizeReelUrl = (u: string) => {
  const m = u.trim().match(REEL_URL);
  return m ? `https://www.instagram.com/reel/${m[3]}/` : null;
};

export const shortcodeOf = (u: string) => u.match(REEL_URL)?.[3] ?? u;

function decode(b64: string | undefined): Float32Array | null {
  if (!b64) return null;
  const bin = atob(b64);
  const out = new Float32Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    const v = bin.charCodeAt(i);
    out[i] = (v > 127 ? v - 256 : v) / 127;
  }
  return out;
}

/** Turns "owner/name", a GitHub URL or caption text into a catalog repo (or a best guess). */
export async function resolveRepo(data: Data, repo: string, caption: string): Promise<string | null> {
  const direct = repo.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/+$/, '');
  if (/^[\w.-]+\/[\w.-]+$/.test(direct)) return direct;
  if (!caption.trim()) return null;
  const cat = { names: data.repos.map((r) => r.n), stars: data.repos.map((r) => r.s), byFull: data.byName };
  const m = await resolve(caption, cat);
  return m[0] && m[0].confidence >= 0.55 ? m[0].full : null;
}

export function reelText(item: ReelItem, repo?: Repo): string {
  return [item.caption, item.creator, repo ? `${repo.n.split('/')[1].replace(/[-_]/g, ' ')} ${repo.d} ${repo.t.join(' ')}` : ''].join(' ');
}

export async function buildItems(data: Data, local: LocalReel[]): Promise<ReelItem[]> {
  const items: ReelItem[] = [];
  const list = data.reels.reels as Reel[];
  const ownVecs = data.reelVecs?.length === list.length * data.dims;
  list.forEach((r, i) => {
    const c = data.creatorByHandle.get(r.creator);
    const repoRow = r.repo ? data.byName.get(r.repo.toLowerCase()) : undefined;
    items.push({
      key: `c:${r.url}`, url: r.url, shortcode: shortcodeOf(r.url), creator: r.creator, posted: r.posted, caption: r.caption ?? '',
      repo: r.repo, repoRow, source: 'curated',
      verified: !!c?.eligible, badge: c?.badge ?? 'pending', trust: c?.trust ?? 0.3,
      vec: ownVecs ? rowVector(data.reelVecs, data.dims, i) : decode(r.vec) ?? (repoRow !== undefined ? rowVector(data.vecs, data.dims, repoRow) : null),
      likes: r.likes, comments: r.comments,
    });
  });
  for (const r of local) {
    if (items.some((x) => x.url === r.url)) continue;
    items.push({
      key: `l:${r.url}`, url: r.url, shortcode: shortcodeOf(r.url), creator: r.creator, posted: r.posted, caption: r.caption,
      repo: r.repo, repoRow: r.repo ? data.byName.get(r.repo.toLowerCase()) : undefined, source: 'local',
      verified: false, badge: 'local', trust: 0.4, vec: null,
    });
  }
  return items.sort((a, b) => Date.parse(b.posted) - Date.parse(a.posted));
}

const dot = (a: Float32Array, b: Float32Array) => {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s;
};

/** Ranks reels for a need. `relevance` (0–1) says how well the reel matches; low means "nothing on this yet". */
// Per-feed text index: built once per items array, not on every keystroke (feeds can hold thousands of reels).
const indexes = new WeakMap<ReelItem[], { bm: BM25; platforms: string[][] }>();
function indexFor(items: ReelItem[], data: Data) {
  let ix = indexes.get(items);
  if (!ix) {
    const raw = items.map((i) => reelText(i, i.repoRow !== undefined ? data.repos[i.repoRow] : undefined));
    ix = { bm: new BM25(raw.map(tokens)), platforms: raw.map((t) => understand(t, data.ranking).platforms) };
    indexes.set(items, ix);
  }
  return ix;
}

export function rankReels(query: string, qvec: Float32Array | null, items: ReelItem[], data: Data): ReelHit[] {
  if (!items.length) return [];
  const ix = indexFor(items, data);
  const requiredPlatforms = understand(query, data.ranking).platforms;
  const kwRaw = ix.bm.scores(tokens(query));
  const kwMax = kwRaw.reduce((m, v) => (v > m ? v : m), 0);
  return items
    .map((item, k) => {
      const sem = qvec && item.vec ? Math.min(1, Math.max(0, (dot(qvec, item.vec) - 0.15) / 0.5)) : 0;
      const kw = kwMax > 0 ? kwRaw[k] / kwMax : 0;
      const describedPlatforms = ix.platforms[k];
      const platformFits = requiredPlatforms.every((p) => describedPlatforms.includes(p));
      // A generic AI similarity does not establish support for an explicitly requested platform.
      const relevance = platformFits ? (qvec && item.vec ? 0.75 * sem + 0.25 * kw : kw) : 0;
      const days = (Date.now() - Date.parse(item.posted)) / 864e5;
      const recency = Math.exp(-Math.max(0, days) / 60);
      const health = item.repoRow !== undefined ? data.repos[item.repoRow].sc.health : 0.5;
      // A reel that names its repo is the better answer when relevance is close: the visitor gets the link.
      const score = 0.62 * relevance + 0.14 * recency + 0.14 * item.trust + 0.1 * health + (item.verified ? 0.04 : 0) + (item.repoRow !== undefined ? 0.06 : 0);
      return { item, score, relevance };
    })
    .sort((a, b) => b.score - a.score);
}

/** Reels loaded from a per-repo shard: their repo's embedding stands in for a reel vector. */
export function itemsFromShard(list: Reel[], data: Data): ReelItem[] {
  return list.map((r) => {
    const c = data.creatorByHandle.get(r.creator);
    const repoRow = r.repo ? data.byName.get(r.repo.toLowerCase()) : undefined;
    return {
      key: `c:${r.url}`, url: r.url, shortcode: shortcodeOf(r.url), creator: r.creator, posted: r.posted, caption: r.caption ?? '',
      repo: r.repo, repoRow, source: 'curated' as const, verified: !!c?.eligible, badge: c?.badge ?? 'pending', trust: c?.trust ?? 0.3,
      vec: repoRow !== undefined ? rowVector(data.vecs, data.dims, repoRow) : null, likes: r.likes, comments: r.comments,
    };
  });
}

/** A search query from a caption whose repo isn't named: drop CTAs ("comment X"), tags, mentions and links. */
export function captionQuery(caption: string): string {
  const t = caption
    .replace(/https?:\/\/\S+|[#@][\w.]+/g, ' ')
    .split(/(?<=[.!?\n])\s+/)
    .filter((s) => !/\b(comment|dm|link in bio|follow me|send you)\b/i.test(s))
    .join(' ')
    .replace(/[^\p{L}\p{N}\s'’-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length <= 140 ? t : t.slice(0, 141).replace(/\s+\S*$/, ''); // cut long ones at a word boundary
}
