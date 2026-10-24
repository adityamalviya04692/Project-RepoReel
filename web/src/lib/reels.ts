/* Reel-first search. A reel is the answer; the repo it covers is the supporting detail.
   Sources: curated reels from the pipeline (reels.json) and reels the visitor adds in this
   browser (localStorage). Ranking blends meaning, keywords, recency, creator trust and repo health. */

import type { Data, Reel, Repo } from './data';
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
  for (const r of data.reels.reels as Reel[]) {
    const c = data.creatorByHandle.get(r.creator);
    items.push({
      key: `c:${r.url}`, url: r.url, shortcode: shortcodeOf(r.url), creator: r.creator, posted: r.posted, caption: r.caption ?? '',
      repo: r.repo, repoRow: r.repo ? data.byName.get(r.repo.toLowerCase()) : undefined, source: 'curated',
      verified: !!c?.eligible, badge: c?.badge ?? 'pending', trust: c?.trust ?? 0.3, vec: decode(r.vec),
      likes: r.likes, comments: r.comments,
    });
  }
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
export function rankReels(query: string, qvec: Float32Array | null, items: ReelItem[], data: Data): ReelHit[] {
  if (!items.length) return [];
  const rawTexts = items.map((i) => reelText(i, i.repoRow !== undefined ? data.repos[i.repoRow] : undefined));
  const texts = rawTexts.map(tokens);
  const requiredPlatforms = understand(query, data.ranking).platforms;
  const kwRaw = new BM25(texts).scores(tokens(query));
  const kwMax = Math.max(0, ...kwRaw);
  return items
    .map((item, k) => {
      const sem = qvec && item.vec ? Math.min(1, Math.max(0, (dot(qvec, item.vec) - 0.15) / 0.5)) : 0;
      const kw = kwMax > 0 ? kwRaw[k] / kwMax : 0;
      const describedPlatforms = understand(rawTexts[k], data.ranking).platforms;
      const platformFits = requiredPlatforms.every((p) => describedPlatforms.includes(p));
      // A generic AI similarity does not establish support for an explicitly requested platform.
      const relevance = platformFits ? (qvec && item.vec ? 0.75 * sem + 0.25 * kw : kw) : 0;
      const days = (Date.now() - Date.parse(item.posted)) / 864e5;
      const recency = Math.exp(-Math.max(0, days) / 60);
      const health = item.repoRow !== undefined ? data.repos[item.repoRow].sc.health : 0.5;
      const score = 0.62 * relevance + 0.14 * recency + 0.14 * item.trust + 0.1 * health + (item.verified ? 0.04 : 0);
      return { item, score, relevance };
    })
    .sort((a, b) => b.score - a.score);
}
