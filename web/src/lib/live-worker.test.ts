import { afterEach, describe, expect, it, vi } from 'vitest';
import worker from '../../../worker/src/index';

function env() {
  const cache = new Map<string, string>();
  return { CACHE: { get: vi.fn(async (k: string) => cache.get(k) ?? null), put: vi.fn(async (k: string, v: string) => { cache.set(k, v); }) }, APIFY_TOKEN: 'test-token', DAILY_LIMIT: '20', MONTHLY_CAP_USD: '4.5', ALLOWED_ORIGIN: 'https://example.com' } as unknown as Parameters<typeof worker.fetch>[1];
}
const req = (origin = 'https://example.com') => new Request('https://worker.test/live?q=linkedin+jobs', { headers: { Origin: origin } });
afterEach(() => vi.unstubAllGlobals());
describe('live worker launch guards', () => {
  it('rejects lookalike localhost origins without contacting Apify', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect((await worker.fetch(req('http://localhost.evil.test'), env())).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not launch actors when usage is missing or unavailable', async () => {
    for (const response of [new Response('{}'), new Response('', { status: 503 })]) {
      const fetch = vi.fn().mockResolvedValue(response); vi.stubGlobal('fetch', fetch);
      const r = await worker.fetch(req(), env());
      expect((await r.json()).reels).toEqual([]);
      expect(fetch).toHaveBeenCalledTimes(1);
    }
  });
  it('checks fresh usage before each uncached request and caps charges', async () => {
    const fetch = vi.fn().mockImplementation(async (url: string) => url.includes('/limits') ? Response.json({ data: { current: { monthlyUsageUsd: 0 }, limits: { maxMonthlyUsageUsd: 5 } } }) : Response.json([]));
    vi.stubGlobal('fetch', fetch);
    const e = env();
    await worker.fetch(req(), e);
    await worker.fetch(new Request('https://worker.test/live?q=browser+automation'), e);
    expect(fetch.mock.calls.filter(([u]) => u.includes('/limits'))).toHaveLength(2);
    const launches = fetch.mock.calls.filter(([u]) => u.includes('/acts/'));
    expect(launches).toHaveLength(2);
    expect(launches[0][0]).toContain('maxTotalChargeUsd=0.25');
    expect(launches[0][0]).not.toContain('test-token');
  });
  it('stops at a lower account limit', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ data: { current: { monthlyUsageUsd: 0.9 }, limits: { maxMonthlyUsageUsd: 1 } } }));
    vi.stubGlobal('fetch', fetch);
    await worker.fetch(req(), env());
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
