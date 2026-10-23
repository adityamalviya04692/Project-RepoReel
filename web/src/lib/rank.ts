import { dotRow, type Data, type Ranking, type Repo } from './data';

/* Query understanding + hybrid ranking — the same logic and weights as pipeline/rank.py. */

export interface Facets {
  ai: string[];
  platforms: string[];
  language: string | null;
  location: string | null;
  categories: string[];
}

const STOP = new Set('a an the i me my we our for to of in on with and or that which who want need looking something tool tools repo repos github app can help find please some any using use im'.split(' '));
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function tokens(text: string): string[] {
  const out: string[] = [];
  for (let t of text.toLowerCase().match(/[a-z0-9][a-z0-9+#.-]*/g) ?? []) {
    t = t.replace(/^[.-]+|[.-]+$/g, '');
    if (t.length > 4) t = t.replace(/(ing|ers|er|es|s)$/, '');
    else if (t.length === 4 && t.endsWith('s') && !t.endsWith('ss')) t = t.slice(0, -1);
    if (t && !STOP.has(t)) out.push(t);
  }
  return out;
}

export function understand(q: string, lex: Ranking): Facets {
  const ql = q.toLowerCase();
  const has = (w: string, prefix = false) => new RegExp(`\\b${esc(w)}${prefix ? '' : '\\b'}`).test(ql);
  const m = q.match(/\b(?:in|at|near|around|based in)\s+([A-Z][a-zA-Z]+(?:\s[A-Z][a-zA-Z]+)?)/);
  const notPlaces = new Set(['python', 'go', 'rust', 'java', 'excel', 'notion', 'slack']);
  return {
    ai: Object.entries(lex.ai).filter(([, ws]) => ws.some((w) => has(w))).map(([k]) => k),
    platforms: Object.entries(lex.platforms).filter(([, ws]) => ws.some((w) => has(w))).map(([k]) => k),
    language: Object.entries(lex.languages).find(([k]) => has(k))?.[1] ?? null,
    location: m && !notPlaces.has(m[1].toLowerCase()) ? m[1] : null,
    categories: Object.entries(lex.categories).filter(([, ws]) => ws.some((w) => has(w, true))).map(([k]) => k),
  };
}

export function searchText(r: Repo): string {
  const [owner, name] = r.n.split('/');
  return `${name.replace(/[-_]/g, ' ')} ${name} ${owner} ${r.d} ${r.t.join(' ')} ${r.x}`;
}

export class BM25 {
  private docs: Map<string, number>[];
  private lens: number[];
  private avg: number;
  private idf = new Map<string, number>();
  constructor(texts: string[][], private k1 = 1.2, private b = 0.75) {
    this.docs = texts.map((d) => {
      const m = new Map<string, number>();
      for (const t of d) m.set(t, (m.get(t) ?? 0) + 1);
      return m;
    });
    this.lens = texts.map((d) => d.length);
    this.avg = this.lens.reduce((a, b) => a + b, 0) / Math.max(1, this.lens.length);
    const df = new Map<string, number>();
    for (const d of this.docs) for (const t of d.keys()) df.set(t, (df.get(t) ?? 0) + 1);
    const n = texts.length;
    for (const [t, f] of df) this.idf.set(t, Math.log(1 + (n - f + 0.5) / (f + 0.5)));
  }
  scores(q: string[]): Float32Array {
    const out = new Float32Array(this.docs.length);
    const terms = q.filter((t) => this.idf.has(t));
    if (!terms.length) return out;
    this.docs.forEach((d, i) => {
      let s = 0;
      for (const t of terms) {
        const f = d.get(t);
        if (f) s += this.idf.get(t)! * ((f * (this.k1 + 1)) / (f + this.k1 * (1 - this.b + (this.b * this.lens[i]) / this.avg)));
      }
      out[i] = s;
    });
    return out;
  }
}

export interface Ranked {
  i: number;
  score: number;
  parts: { semantic: number; keyword: number; popularity: number; momentum: number; health: number; social: number; freshness: number };
  why: string[];
}

export function rank(query: string, qvec: Float32Array | null, data: Data, bm25: BM25, k = 8): { facets: Facets; results: Ranked[] } {
  const f = understand(query, data.ranking);
  const w = data.ranking.weights;
  const kw = bm25.scores(tokens(`${query} ${f.categories.join(' ')}`));
  let max = 0;
  for (const v of kw) max = Math.max(max, v);
  const out: Ranked[] = [];
  data.repos.forEach((r, i) => {
    const semRaw = qvec ? dotRow(data.vecs, data.dims, i, qvec) : 0;
    const semantic = Math.min(1, Math.max(0, (semRaw - 0.15) / 0.55));
    const keyword = max > 0 ? kw[i] / max : 0;
    const parts = { semantic, keyword, popularity: r.sc.pop ?? 0, momentum: r.sc.momentum, health: r.sc.health, social: r.sc.social, freshness: r.sc.fresh };
    let s = w.semantic * semantic + w.keyword * keyword + w.popularity * parts.popularity + w.momentum * parts.momentum + w.health * parts.health + w.social * parts.social + w.freshness * parts.freshness;
    const why: string[] = [];
    if (f.ai.length) {
      const hit = f.ai.filter((a) => r.ai.includes(a));
      s += hit.length ? 0.06 : -0.04;
      if (hit.length) why.push(`works with ${hit.map(aiLabel).join(', ')}`);
    }
    if (f.language && r.l === f.language) {
      s += 0.03;
      why.push(r.l);
    }
    const catHit = f.categories.filter((c) => r.cat.includes(c));
    if (catHit.length) {
      s += 0.03;
      why.unshift(...catHit.map((c) => data.ranking.labels[c] ?? c));
    }
    const plat = f.platforms.filter((p) => searchText(r).toLowerCase().includes(p));
    if (plat.length) why.push(...plat.map((p) => p[0].toUpperCase() + p.slice(1)));
    if (r.a) s -= 0.2;
    out.push({ i, score: s, parts, why: [...new Set(why)] });
  });
  out.sort((a, b) => b.score - a.score);
  return { facets: f, results: out.slice(0, k) };
}

export const aiLabel = (a: string) => ({ mcp: 'MCP', claude: 'Claude', openai: 'ChatGPT', gemini: 'Gemini', local: 'local models' })[a] ?? a;

/** Nearest repos by embedding (for "Similar repos"). */
export function similar(data: Data, row: number, k = 4): number[] {
  const o = row * data.dims;
  const scores: [number, number][] = [];
  for (let j = 0; j < data.repos.length; j++) {
    if (j === row) continue;
    let s = 0;
    const p = j * data.dims;
    for (let d = 0; d < data.dims; d++) s += data.vecs[o + d] * data.vecs[p + d];
    scores.push([j, s]);
  }
  return scores.sort((a, b) => b[1] - a[1]).slice(0, k).map(([j]) => j);
}
