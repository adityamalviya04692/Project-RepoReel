/* Live Instagram search through the optional free Cloudflare Worker (worker/). Used when the
   nightly index has no reel for a query; the worker caches keywords and caps daily usage. */
import type { Data } from './data';
import { embedQuery } from './embedder';
import { reelText, resolveRepo, shortcodeOf, type ReelItem } from './reels';

export const LIVE_URL: string = import.meta.env.VITE_LIVE_URL ?? '';

interface LiveReel { url: string; creator: string; posted: string; caption: string; likes: number | null; views: number | null }

export async function liveSearch(q: string, data: Data): Promise<{ items: ReelItem[]; note?: string; keywords?: string }> {
  if (!LIVE_URL) return { items: [] };
  const r = await fetch(`${LIVE_URL.replace(/\/$/, '')}/live?q=${encodeURIComponent(q)}`);
  if (!r.ok) return { items: [], note: `live search unavailable (${r.status})` };
  const body = (await r.json()) as { reels: LiveReel[]; note?: string; keywords?: string };
  const items: ReelItem[] = [];
  for (const x of body.reels ?? []) {
    const repo = await resolveRepo(data, '', x.caption);
    const it: ReelItem = {
      key: `v:${x.url}`, url: x.url, shortcode: shortcodeOf(x.url), creator: x.creator, posted: x.posted || new Date().toISOString().slice(0, 10),
      caption: x.caption, repo, repoRow: repo ? data.byName.get(repo.toLowerCase()) : undefined, source: 'local', verified: false,
      badge: 'live', trust: 0.35, vec: null,
    };
    try {
      it.vec = await embedQuery(reelText(it, it.repoRow !== undefined ? data.repos[it.repoRow] : undefined));
    } catch {
      it.vec = null;
    }
    items.push(it);
  }
  // Reels whose caption names a real repo first: those are the ones that answer "which repo?"
  items.sort((a, b) => Number(!!b.repo) - Number(!!a.repo));
  return { items, note: body.note, keywords: body.keywords };
}
