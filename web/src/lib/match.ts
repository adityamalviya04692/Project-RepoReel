/* "Snap a reel": the same candidate extraction as pipeline/matching.py, resolved against the
   catalog in the browser, with GitHub's public API as a fallback for repos we haven't indexed. */

export interface Candidate { text: string; kind: 'url' | 'owner_repo' | 'quoted' | 'hashtag' | 'toolish'; owner?: string }
export interface Match { full: string; confidence: number; method: string; inCatalog: boolean; stars?: number; description?: string }

const STOP = new Set(['github', 'repo', 'repository', 'opensource', 'open', 'source', 'ai', 'aitools', 'chatgpt', 'claude', 'coding', 'python', 'javascript',
  'programming', 'developer', 'tech', 'free', 'tools', 'automation', 'reels', 'viral', 'trending', 'linkinbio', 'follow', 'comment',
  'machinelearning', 'artificialintelligence', 'llm', 'gpt', 'openai', 'aiagent', 'aiagents', 'productivity', 'software', 'code']);

export const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function trigrams(s: string) {
  const t = `  ${normName(s)} `;
  const out = new Set<string>();
  for (let i = 0; i < t.length - 2; i++) out.add(t.slice(i, i + 3));
  return out;
}

export function nameSimilarity(a: string, b: string): number {
  if (normName(a) === normName(b)) return 1;
  const ta = trigrams(a), tb = trigrams(b);
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter++;
  return inter / Math.max(1, new Set([...ta, ...tb]).size);
}

export function extract(text: string): Candidate[] {
  const out: Candidate[] = [];
  const seen = new Set<string>();
  const add = (c: Candidate) => {
    const n = normName(c.text);
    const key = `${(c.owner ?? '').toLowerCase()}/${n}`;
    if (n && !seen.has(key) && !STOP.has(n)) {
      seen.add(key);
      out.push(c);
    }
  };
  // OCR often reads "/" as " / " and splits URLs; normalise common artefacts first.
  const t = (text ?? '').replace(/\s*\/\s*/g, '/').replace(/github\s*\.\s*com/gi, 'github.com');
  for (const m of t.matchAll(/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)/gi)) add({ text: m[2].replace(/\.git$/, ''), kind: 'url', owner: m[1] });
  for (const m of t.matchAll(/(?<![\w./@])([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9_.-]{2,100})(?![\w/])/g)) {
    if (m[1].includes('.') || /^\d+$/.test(m[1])) continue;
    add({ text: m[2], kind: 'owner_repo', owner: m[1] });
  }
  for (const m of t.matchAll(/[`"“”']([A-Za-z0-9][\w.-]{2,40})[`"“”']/g)) add({ text: m[1], kind: 'quoted' });
  for (const m of t.matchAll(/#([A-Za-z][A-Za-z0-9_]{3,40})/g)) add({ text: m[1], kind: 'hashtag' });
  for (const m of t.matchAll(/\b([A-Za-z][a-z0-9]+(?:[A-Z][a-z0-9]+)+|[A-Za-z0-9]+(?:[-_][A-Za-z0-9]+)+|[A-Za-z]+\d+[A-Za-z]*)\b/g)) add({ text: m[1], kind: 'toolish' });
  return out;
}

interface Catalog { names: string[]; stars: number[]; byFull: Map<string, number> }

async function githubSearch(name: string): Promise<{ full: string; stars: number; description: string } | null> {
  try {
    const r = await fetch(`https://api.github.com/search/repositories?q=${encodeURIComponent(`${name} in:name`)}&sort=stars&per_page=3`);
    if (!r.ok) return null;
    const it = (await r.json()).items?.[0];
    return it ? { full: it.full_name, stars: it.stargazers_count, description: it.description ?? '' } : null;
  } catch {
    return null;
  }
}

async function githubRepo(full: string): Promise<{ full: string; stars: number; description: string } | null> {
  try {
    const r = await fetch(`https://api.github.com/repos/${full}`);
    if (!r.ok) return null;
    const j = await r.json();
    return { full: j.full_name, stars: j.stargazers_count, description: j.description ?? '' };
  } catch {
    return null;
  }
}

export async function resolve(text: string, cat: Catalog, online = true): Promise<Match[]> {
  const byName = new Map<string, number[]>();
  cat.names.forEach((n, i) => {
    const k = normName(n.split('/')[1]);
    byName.set(k, [...(byName.get(k) ?? []), i]);
  });
  const maxLog = Math.max(1, ...cat.stars.map((s) => Math.log1p(s)));
  const found = new Map<string, Match>();
  const put = (m: Match) => {
    const prev = found.get(m.full.toLowerCase());
    if (!prev || m.confidence > prev.confidence) found.set(m.full.toLowerCase(), m);
  };
  let lookups = 0;
  for (const c of extract(text)) {
    if (c.owner) {
      const full = `${c.owner}/${c.text}`;
      const i = cat.byFull.get(full.toLowerCase());
      if (i !== undefined) {
        put({ full: cat.names[i], confidence: c.kind === 'url' ? 0.97 : 0.92, method: c.kind, inCatalog: true, stars: cat.stars[i] });
        continue;
      }
      // OCR slips ("browser-ug" for "browser-use"): fuzzy-match within the same owner's repos.
      const owned = cat.names.map((n, j) => [n, j] as const).filter(([n]) => n.toLowerCase().startsWith(c.owner!.toLowerCase() + '/'));
      const best = owned.map(([n, j]) => ({ n, j, s: nameSimilarity(c.text, n.split('/')[1]) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.45) {
        put({ full: best.n, confidence: Math.round((0.6 + 0.4 * best.s) * 1000) / 1000, method: `${c.kind} · fuzzy`, inCatalog: true, stars: cat.stars[best.j] });
        continue;
      }
      if (online && lookups < 4) {
        lookups++;
        const g = await githubRepo(full);
        if (g) {
          put({ full: g.full, confidence: c.kind === 'url' ? 0.95 : 0.9, method: c.kind, inCatalog: false, stars: g.stars, description: g.description });
          continue;
        }
      }
    }
    const pool = byName.get(normName(c.text)) ?? [];
    for (const i of pool) {
      const ns = nameSimilarity(c.text, cat.names[i].split('/')[1]);
      const conf = 0.45 * ns + 0.35 * 0.5 + 0.1 * (c.owner && cat.names[i].toLowerCase().startsWith(c.owner.toLowerCase() + '/') ? 1 : 0) + 0.1 * (Math.log1p(cat.stars[i]) / maxLog) - (pool.length > 1 ? 0.05 : 0);
      put({ full: cat.names[i], confidence: Math.round(conf * 1000) / 1000, method: c.kind, inCatalog: true, stars: cat.stars[i] });
    }
    if (!pool.length && online && lookups < 4 && c.kind !== 'toolish') {
      lookups++;
      const g = await githubSearch(c.text);
      if (g && nameSimilarity(c.text, g.full.split('/')[1]) >= 0.6) {
        put({ full: g.full, confidence: Math.round((0.45 * nameSimilarity(c.text, g.full.split('/')[1]) + 0.25) * 1000) / 1000, method: `${c.kind} · GitHub search`, inCatalog: false, stars: g.stars, description: g.description });
      }
    }
  }
  return [...found.values()].sort((a, b) => b.confidence - a.confidence);
}
