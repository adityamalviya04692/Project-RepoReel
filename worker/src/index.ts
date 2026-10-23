/* RepoReel live search (Cloudflare Workers free tier).
   GET /live?q=<need> → recent Instagram reels for the need's keywords, via Apify's free plan.
   Keyword results are cached for 7 days in KV, live calls are capped per day, and Apify's usage
   API is checked so the monthly free credit is never exceeded. The browser matches captions to
   repositories itself. */

interface Env {
  CACHE: KVNamespace;
  APIFY_TOKEN: string;
  DAILY_LIMIT: string;
  MONTHLY_CAP_USD: string;
  ALLOWED_ORIGIN: string;
}

const STOP = new Set('a an the i me my we our for to of in on with and or that which who want need looking something tool tools repo repos github app can help find please some any using use im would like make build get'.split(' '));
const DAY = 86400;

/** Up to 3 distinctive words from the need, plus "github" so reels about repos surface. */
export function keywords(q: string): string {
  const words = (q.toLowerCase().match(/[a-z0-9+#.-]{3,}/g) ?? []).filter((w) => !STOP.has(w));
  return [...new Set(words)].slice(0, 3).concat('github').join(' ');
}

function cors(env: Env, req: Request): Record<string, string> {
  const origin = req.headers.get('Origin') ?? '';
  const allowed = origin === env.ALLOWED_ORIGIN || origin.startsWith('http://localhost') || origin.startsWith('http://127.0.0.1');
  return { 'Access-Control-Allow-Origin': allowed ? origin : env.ALLOWED_ORIGIN, 'Access-Control-Allow-Methods': 'GET', 'Content-Type': 'application/json' };
}

async function budgetOk(env: Env): Promise<boolean> {
  const cached = await env.CACHE.get('budget');
  if (cached) return cached === 'ok';
  const r = await fetch(`https://api.apify.com/v2/users/me/limits?token=${env.APIFY_TOKEN}`);
  const used = r.ok ? Number((await r.json<{ data: { current: { monthlyUsageUsd: number } } }>()).data.current.monthlyUsageUsd) : Infinity;
  const ok = used + 0.25 < Number(env.MONTHLY_CAP_USD);
  await env.CACHE.put('budget', ok ? 'ok' : 'over', { expirationTtl: 3600 });
  return ok;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(env, req);
    const url = new URL(req.url);
    if (url.pathname !== '/live') return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers });
    const q = (url.searchParams.get('q') ?? '').slice(0, 200);
    if (!q.trim()) return new Response(JSON.stringify({ error: 'missing q' }), { status: 400, headers });
    const kw = keywords(q);
    const key = `kw:${kw}`;
    const hit = await env.CACHE.get(key);
    if (hit) return new Response(hit, { headers: { ...headers, 'X-Cache': 'hit' } });

    const today = new Date().toISOString().slice(0, 10);
    const used = Number((await env.CACHE.get(`count:${today}`)) ?? 0);
    if (used >= Number(env.DAILY_LIMIT)) return new Response(JSON.stringify({ keywords: kw, reels: [], note: 'daily live-search limit reached' }), { headers });
    if (!(await budgetOk(env))) return new Response(JSON.stringify({ keywords: kw, reels: [], note: 'monthly free credit nearly used' }), { headers });
    await env.CACHE.put(`count:${today}`, String(used + 1), { expirationTtl: 2 * DAY });

    const r = await fetch(`https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items?token=${env.APIFY_TOKEN}&timeout=120`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hashtags: [kw], keywordSearch: true, resultsType: 'reels', resultsLimit: 12 }),
    });
    if (!r.ok) return new Response(JSON.stringify({ keywords: kw, reels: [], note: `search failed (${r.status})` }), { status: 502, headers });
    type Item = { shortCode?: string; ownerUsername?: string; timestamp?: string; caption?: string; likesCount?: number; videoPlayCount?: number; productType?: string; type?: string };
    const items = (await r.json<Item[]>()) ?? [];
    const reels = items
      .filter((i) => i.shortCode && i.ownerUsername && (i.productType === 'clips' || String(i.type).toLowerCase() === 'video'))
      .map((i) => ({
        url: `https://www.instagram.com/reel/${i.shortCode}/`,
        creator: i.ownerUsername!.toLowerCase(),
        posted: (i.timestamp ?? '').slice(0, 10),
        caption: (i.caption ?? '').slice(0, 1200),
        likes: i.likesCount !== undefined && i.likesCount >= 0 ? i.likesCount : null,
        views: i.videoPlayCount ?? null,
      }));
    const body = JSON.stringify({ keywords: kw, reels, fetched: new Date().toISOString() });
    await env.CACHE.put(key, body, { expirationTtl: 7 * DAY });
    return new Response(body, { headers: { ...headers, 'X-Cache': 'miss' } });
  },
};
