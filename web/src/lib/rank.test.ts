import { describe, expect, it } from 'vitest';
import { BM25, tokens, understand } from './rank';
import { extract, nameSimilarity, resolve } from './match';
import type { Ranking } from './data';

const lex = {
  weights: { semantic: 0.46, keyword: 0.14, popularity: 0.1, momentum: 0.1, health: 0.08, social: 0.07, freshness: 0.05 },
  ai: { mcp: ['mcp'], claude: ['claude'], openai: ['chatgpt', 'openai'], gemini: ['gemini'], local: ['ollama'] },
  platforms: { linkedin: ['linkedin'], naukri: ['naukri'] },
  languages: { python: 'Python' },
  categories: { 'job-search': ['job', 'jobs', 'apply'], scraping: ['scrape', 'scraper'] },
  labels: { 'job-search': 'Job search' },
} as unknown as Ranking;

describe('query understanding (mirrors pipeline/rank.py)', () => {
  it('extracts facets', () => {
    const f = understand("I'm job hunting in Pune and want to scrape LinkedIn with Claude in Python", lex);
    expect(f).toMatchObject({ location: 'Pune', language: 'Python', ai: ['claude'], platforms: ['linkedin'] });
    expect(f.categories).toEqual(expect.arrayContaining(['job-search', 'scraping']));
  });
  it('tokenises with light stemming', () => {
    expect(tokens('Scraping the jobs listings')).toEqual(['scrap', 'job', 'listing']);
  });
  it('ranks with BM25', () => {
    const bm = new BM25([tokens('browser automation agent'), tokens('linkedin jobs scraper'), tokens('voice cloning')]);
    expect(Array.from(bm.scores(tokens('scrape linkedin jobs'))).indexOf(Math.max(...bm.scores(tokens('scrape linkedin jobs'))))).toBe(1);
  });
});

describe('snap a reel (mirrors pipeline/matching.py)', () => {
  it('extracts candidates from OCR-ish text', () => {
    const c = extract('github . com / unclecode / crawl4ai\nAlso try browser-use 🔥 #LangGraph');
    expect(c.map((x) => `${x.kind}:${x.owner ? x.owner + '/' : ''}${x.text}`)).toEqual(
      expect.arrayContaining(['url:unclecode/crawl4ai', 'toolish:browser-use', 'hashtag:LangGraph']),
    );
  });
  it('resolves against the catalog offline', async () => {
    const names = ['unclecode/crawl4ai', 'browser-use/browser-use', 'someone/browser-use-ui'];
    const cat = { names, stars: [50000, 70000, 30], byFull: new Map(names.map((n, i) => [n.toLowerCase(), i])) };
    const m = await resolve('This is github.com/unclecode/crawl4ai and browser_use', cat, false);
    expect(m[0]).toMatchObject({ full: 'unclecode/crawl4ai', inCatalog: true });
    expect(m.some((x) => x.full === 'browser-use/browser-use')).toBe(true);
    expect(nameSimilarity('browser_use', 'Browser-Use')).toBe(1);
    const ocr = await resolve('github.com/browser-use/browser-ug', cat, false);
    expect(ocr[0]).toMatchObject({ full: 'browser-use/browser-use' });
    expect(ocr[0].confidence).toBeGreaterThanOrEqual(0.8);
  });
});
