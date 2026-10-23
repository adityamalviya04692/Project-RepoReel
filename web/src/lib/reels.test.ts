import { describe, expect, it, vi } from 'vitest';
vi.mock('./embedder', () => ({ embedQuery: vi.fn(() => new Promise(() => {})) }));
import { buildItems, rankReels, type ReelItem } from './reels';
import type { Data } from './data';

const data = { reels: { reels: [] }, repos: [], byName: new Map(), creatorByHandle: new Map() } as unknown as Data;
const item: ReelItem = { key: 'local', url: 'https://www.instagram.com/reel/Test123/', shortcode: 'Test123', creator: 'tester', posted: '2026-10-23', caption: 'linkedin job applications', repo: null, repoRow: undefined, source: 'local', verified: false, badge: 'local', trust: 0.4, vec: null };

describe('reels without a downloaded model', () => {
  it('makes local additions available without waiting for model download', async () => {
    const local = { ...item, added: '2026-10-23' };
    const items = await buildItems(data, [local]);
    expect(items).toHaveLength(1);
    expect(items[0].vec).toBeNull();
  });
  it('retains keyword relevance for an item without a vector after the query model loads', () => {
    const cold = rankReels('linkedin jobs', null, [item], data)[0];
    const warm = rankReels('linkedin jobs', new Float32Array([1, 0]), [item], data)[0];
    expect(cold.relevance).toBe(1);
    expect(warm.relevance).toBe(cold.relevance);
  });
});
