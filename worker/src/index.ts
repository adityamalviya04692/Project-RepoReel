/* RepoReel live search (Cloudflare Workers free tier).
   GET /live?q=<need> → recent Instagram reels for the need's keywords, via Apify's free plan.
   Keyword results are cached for 7 days in KV, live calls are capped per day, and Apify's usage
   API is checked so the monthly free credit is never exceeded. The browser matches captions to
   repositories itself. */

interface Env {
  CACHE: {
    get(key: string): Promise<string | null>;
    put(key: string, value: string, options?: { expirationTtl: number }): Promise<unknown>;
  };
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
  const allowed = origin === env.ALLOWED_ORIGIN || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  return { 'Access-Control-Allow-Origin': allowed ? origin : env.ALLOWED_ORIGIN, 'Access-Control-Allow-Methods': 'GET', 'Content-Type': 'application/json' };
}

async function budgetOk(env: Env): Promise<boolean> {
  if (!env.APIFY_TOKEN) return false;
  try {
    const r = await fetch('https://api.apify.com/v2/users/me/limits', { headers: { Authorization: `Bearer ${env.APIFY_TOKEN}` } });
    if (!r.ok) return false;
    const { data } = await r.json() as { data: { current: { monthlyUsageUsd: number }; limits: { maxMonthlyUsageUsd: number } } };
    const used = data.current.monthlyUsageUsd;
    const plan = data.limits.maxMonthlyUsageUsd;
    const cap = Number(env.MONTHLY_CAP_USD);
    return [used, plan, cap].every(Number.isFinite) && used >= 0 && used + 0.25 < Math.min(plan, cap);
  } catch {
    return false;
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const headers = cors(env, req);
    const origin = req.headers.get('Origin');
    if (origin && headers['Access-Control-Allow-Origin'] !== origin) return new Response(JSON.stringify({ error: 'origin not allowed' }), { status: 403, headers });
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (req.method !== 'GET') return new Response(JSON.stringify({ error: 'method not allowed' }), { status: 405, headers });
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
    const dailyLimit = Number(env.DAILY_LIMIT);
    if (!Number.isFinite(dailyLimit) || dailyLimit <= 0 || !Number.isFinite(used) || used >= dailyLimit) return new Response(JSON.stringify({ keywords: kw, reels: [], note: 'daily live-search limit reached' }), { headers });
    if (!(await budgetOk(env))) return new Response(JSON.stringify({ keywords: kw, reels: [], note: 'monthly free credit nearly used' }), { headers });
    await env.CACHE.put(`count:${today}`, String(used + 1), { expirationTtl: 2 * DAY });

    let r: Response;
    try {
      r = await fetch('https://api.apify.com/v2/acts/apify~instagram-hashtag-scraper/run-sync-get-dataset-items?timeout=120&maxTotalChargeUsd=0.25', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.APIFY_TOKEN}` },
      body: JSON.stringify({ hashtags: [kw], keywordSearch: true, resultsType: 'reels', resultsLimit: 12 }),
    });
    } catch {
      return new Response(JSON.stringify({ keywords: kw, reels: [], note: 'search unavailable' }), { status: 502, headers });
    }
    if (!r.ok) return new Response(JSON.stringify({ keywords: kw, reels: [], note: `search failed (${r.status})` }), { status: 502, headers });
    type Item = { shortCode?: string; ownerUsername?: string; timestamp?: string; caption?: string; likesCount?: number; videoPlayCount?: number; productType?: string; type?: string };
    const items = (await r.json() as Item[]) ?? [];
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
