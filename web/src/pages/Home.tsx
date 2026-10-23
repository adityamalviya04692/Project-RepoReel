import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Data } from '../lib/data';
import { embedQuery, isReady, onLoad, warm } from '../lib/embedder';
import { compact } from '../lib/format';
import { BM25, aiLabel, rank, searchText, tokens, type Ranked, type Facets } from '../lib/rank';
import RepoCard from '../components/RepoCard';
import HealthStrip from '../components/HealthStrip';

const EXAMPLES = [
  'Apply to jobs on LinkedIn automatically, works with Claude',
  'Scrape any website into clean markdown for my LLM',
  'Let an AI agent use my browser',
  'Chat with my PDFs, runs locally',
  'Turn podcasts into transcripts offline',
];

export default function Home({ data, query, setQuery, onOpen }: { data: Data; query: string; setQuery: (q: string) => void; onOpen: (row: number) => void }) {
  const bm25 = useMemo(() => new BM25(data.repos.map((r) => tokens(searchText(r)))), [data]);
  const [draft, setDraft] = useState(query);
  const [results, setResults] = useState<{ facets: Facets; results: Ranked[]; semantic: boolean } | null>(null);
  const [modelP, setModelP] = useState(isReady() ? 1 : 0);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => onLoad(setModelP), []);
  useEffect(() => setDraft(query), [query]);

  useEffect(() => {
    if (!query.trim()) {
      setResults(null);
      return;
    }
    let live = true;
    window.scrollTo({ top: 0 });
    // Keyword ranking is instant; the semantic pass replaces it as soon as the query is embedded.
    setResults({ ...rank(query, null, data, bm25), semantic: false });
    embedQuery(query)
      .then((v) => live && setResults({ ...rank(query, v, data, bm25), semantic: true }))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [query, data, bm25]);

  const rising = useMemo(
    () => data.repos.map((r, i) => ({ r, i })).filter(({ r }) => (r.mo.d7 ?? 0) > 0 && !r.a).sort((a, b) => (b.r.mo.d7 ?? 0) - (a.r.mo.d7 ?? 0)).slice(0, 12),
    [data],
  );
  const trusted = data.creators.creators.filter((c) => c.eligible).slice(0, 6);

  const submit = (q: string) => {
    setQuery(q.trim());
    input.current?.blur();
  };

  return (
    <>
      <section className={`tile parchment hero${results ? ' compact' : ''}`}>
        <div className="wrap narrow">
          {!results && <p className="eyebrow">Find the repo. Watch the proof.</p>}
          <h1>{results ? 'What are you building?' : <>What are you<br />building?</>}</h1>
          <form className="search-pill" onSubmit={(e) => (e.preventDefault(), submit(draft))} role="search">
            <span aria-hidden="true" className="glass">⌕</span>
            <input
              ref={input}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onFocus={warm}
              placeholder="Describe the tool you need, in your own words"
              aria-label="Describe what you're building"
            />
            {draft && <button type="button" className="clear" onClick={() => (setDraft(''), setQuery(''), input.current?.focus())} aria-label="Clear">✕</button>}
            <button className="btn primary" disabled={!draft.trim()}>Search</button>
          </form>
          {!results && (
            <div className="chips center">
              {EXAMPLES.map((e) => (
                <button key={e} className="chip" onClick={() => (setDraft(e), submit(e))}>{e}</button>
              ))}
            </div>
          )}
          {!results && <p className="fine center">{compact(data.repos.length)} repositories, refreshed daily · ranked by meaning, momentum, health and creator proof</p>}
        </div>
      </section>

      <AnimatePresence mode="wait">
        {results ? (
          <motion.section key="results" className="tile light results" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <div className="wrap narrow">
              <Understood facets={results.facets} labels={data.ranking.labels} semantic={results.semantic} modelP={modelP} />
              <div className="result-list">
                {results.results.map((x, k) => (
                  <RepoCard key={data.repos[x.i].n} r={data.repos[x.i]} data={data} why={x.why} index={k} onOpen={() => onOpen(x.i)} />
                ))}
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.div key="home" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <section className="tile dark">
              <div className="wrap">
                <p className="eyebrow on-dark">Rising this week</p>
                <h2>Momentum from our own daily snapshots.</h2>
                <div className="rail" role="list">
                  {rising.map(({ r, i }) => (
                    <button key={r.n} className="rail-card" role="listitem" onClick={() => onOpen(i)}>
                      <img className="avatar" src={`https://github.com/${r.n.split('/')[0]}.png?size=72`} alt="" width="36" height="36" loading="lazy" />
                      <b>{r.n.split('/')[1]}</b>
                      <span>{r.d.slice(0, 96)}</span>
                      <HealthStrip r={r} dark />
                    </button>
                  ))}
                </div>
              </div>
            </section>
            <section className="tile light">
              <div className="wrap">
                <p className="eyebrow">Trusted creators</p>
                <h2>Reels count only from vetted creators.</h2>
                <p className="lead muted">
                  {compact(data.creators.gates.min_followers)}+ followers, {data.creators.gates.min_posts_60d}+ repo posts in 60 days, and an accuracy score
                  checked against GitHub: creators who hype dead repos sink automatically.
                </p>
                {trusted.length ? (
                  <div className="creator-row">
                    {trusted.map((c) => (
                      <a key={c.handle} className="creator-chip" href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noreferrer">
                        <b>@{c.handle}</b>
                        <span>{compact(c.followers)} followers · trust {Math.round(c.trust * 100)}</span>
                      </a>
                    ))}
                  </div>
                ) : (
                  <p className="empty-note">The creator list is being curated. <a href="#/creators">See how creators are vetted →</a></p>
                )}
              </div>
            </section>
            <section className="tile parchment">
              <div className="wrap split">
                <div>
                  <p className="eyebrow">Saw a reel?</p>
                  <h2>Snap it. Get the repo.</h2>
                  <p className="lead muted">Drop a screenshot of the frame that shows the repo. OCR runs in your browser and finds the exact repository, with no DMs and no "comment REPO".</p>
                  <a className="btn primary" href="#/snap">Snap a reel</a>
                </div>
                <div>
                  <p className="eyebrow">Built like a data platform</p>
                  <h2>A pipeline you can inspect.</h2>
                  <p className="lead muted">GitHub, Hacker News and curated creator data flow through bronze, silver and gold layers every night, with quality checks and retrieval evaluation.</p>
                  <a className="btn secondary" href="#/pipeline">Pipeline status</a>
                </div>
              </div>
            </section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

function Understood({ facets, labels, semantic, modelP }: { facets: Facets; labels: Record<string, string>; semantic: boolean; modelP: number }) {
  const chips = [
    ...facets.categories.map((c) => labels[c] ?? c),
    ...facets.platforms.map((p) => p[0].toUpperCase() + p.slice(1)),
    ...facets.ai.map((a) => `works with ${aiLabel(a)}`),
    ...(facets.language ? [facets.language] : []),
    ...(facets.location ? [`📍 ${facets.location}`] : []),
  ];
  return (
    <div className="understood">
      <span className="label">Understood</span>
      {chips.length ? chips.map((c) => <span key={c} className="chip static">{c}</span>) : <span className="muted">your description</span>}
      <span className={`mode${semantic ? ' on' : ''}`} title={semantic ? 'Ranked by meaning and keywords' : 'Keyword ranking until the language model loads'}>
        {semantic ? '● semantic' : modelP > 0 && modelP < 1 ? `loading model ${Math.round(modelP * 100)}%` : '○ keyword'}
      </span>
    </div>
  );
}
