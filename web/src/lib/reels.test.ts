import { describe, expect, it, vi } from 'vitest';
vi.mock('./embedder', () => ({ embedQuery: vi.fn(() => new Promise(() => {})) }));
import { buildItems, rankReels, type ReelItem } from './reels';
import type { Data } from './data';

const data = { reels: { reels: [] }, repos: [], byName: new Map(), creatorByHandle: new Map(), ranking: { ai: {}, platforms: { linkedin: ['linkedin'] }, languages: {}, categories: {} } } as unknown as Data;
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


describe('explicit platform requests', () => {
  it('does not call an unrelated AI reel a LinkedIn match, even with a high model similarity', () => {
    const unrelated = { ...item, caption: 'AI video editing', vec: new Float32Array([1, 0]) };
    expect(rankReels('Apply to LinkedIn jobs with AI', null, [unrelated], data)[0].relevance).toBe(0);
    expect(rankReels('Apply to LinkedIn jobs with AI', new Float32Array([1, 0]), [unrelated], data)[0].relevance).toBe(0);
  });
  it('accepts platform evidence from the linked repository as well as the caption', () => {
    const linkedData = { ...data, repos: [{ n: 'owner/job-tool', d: 'A LinkedIn job assistant', t: [], sc: { health: 1 } }] } as unknown as Data;
    const linked = { ...item, caption: 'AI application assistant', repoRow: 0 };
    expect(rankReels('LinkedIn jobs', null, [linked], linkedData)[0].relevance).toBe(1);
  });
});
