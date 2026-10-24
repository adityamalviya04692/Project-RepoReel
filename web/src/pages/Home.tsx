import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Data } from '../lib/data';
import { embedQuery, isReady, onLoad, warm } from '../lib/embedder';
import { compact } from '../lib/format';
import { BM25, aiLabel, rank, searchText, tokens, type Facets, type Ranked } from '../lib/rank';
import { buildItems, loadLocal, rankReels, reelText, type ReelHit, type ReelItem } from '../lib/reels';
import Phone from '../components/Phone';
import ReelResult from '../components/ReelResult';
import RepoCard from '../components/RepoCard';
import HealthStrip from '../components/HealthStrip';
import AddReel from '../components/AddReel';
import { LIVE_URL, liveSearch } from '../lib/live';

const EXAMPLES = [
  'Apply to LinkedIn jobs automatically with AI',
  'Scrape any website into clean data for my LLM',
  'Let an AI agent control my browser',
  'Chat with my PDFs on my laptop',
  'Turn videos into transcripts offline',
];
const MATCH_MIN = 0.3; // below this relevance a reel isn't really about the need

export default function Home({ data, query, setQuery, onOpen }: { data: Data; query: string; setQuery: (q: string) => void; onOpen: (row: number) => void }) {
  const bm25 = useMemo(() => new BM25(data.repos.map((r) => tokens(searchText(r)))), [data]);
  const [draft, setDraft] = useState(query);
  const [items, setItems] = useState<ReelItem[]>([]);
  const [version, setVersion] = useState(0);
  const [qvec, setQvec] = useState<Float32Array | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [live, setLive] = useState<{ q: string; items: ReelItem[]; state: 'idle' | 'searching' | 'done'; note?: string }>({ q: '', items: [], state: 'idle' });
  const [modelP, setModelP] = useState(isReady() ? 1 : 0);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => onLoad(setModelP), []);
  useEffect(() => setDraft(query), [query]);
  useEffect(() => {
    let live = true;
    void buildItems(data, loadLocal()).then(async (x) => {
      if (!live) return;
      setItems(x);
      // Show local additions immediately; improve their search vectors in the background.
      if (!x.some((item) => !item.vec)) return;
      const enriched = await Promise.all(x.map(async (item) => {
        if (item.vec) return item;
        try {
          const vec = await embedQuery(reelText(item, item.repoRow !== undefined ? data.repos[item.repoRow] : undefined));
          return { ...item, vec };
        } catch {
          return item;
        }
      }));
      if (live) setItems(enriched);
    });
    return () => {
      live = false;
    };
  }, [data, version]);

  useEffect(() => {
    setQvec(null);
    window.scrollTo({ top: 0 });
    if (!query.trim()) return;
    let live = true;
    embedQuery(query).then((v) => live && setQvec(v)).catch(() => {});
    return () => {
      live = false;
    };
  }, [query]);

  const pool = useMemo(() => (live.q === query ? [...items, ...live.items.filter((l) => !items.some((i) => i.url === l.url))] : items), [items, live, query]);
  const reelHits: ReelHit[] = useMemo(() => (query.trim() ? rankReels(query, qvec, pool, data) : []), [query, qvec, pool, data]);
  const strong = reelHits.filter((h) => h.relevance >= MATCH_MIN);
  const shownReels = query.trim() ? (strong.length ? strong : reelHits.filter((h) => h.relevance > 0).slice(0, 3)) : [];
  const repos: { facets: Facets; results: Ranked[] } | null = useMemo(() => (query.trim() ? rank(query, qvec, data, bm25, 6) : null), [query, qvec, data, bm25]);
  const reelRepos = new Set(shownReels.map((h) => h.item.repo?.toLowerCase()));
  const repoOnly = repos ? repos.results.filter((x) => !reelRepos.has(data.repos[x.i].n.toLowerCase())).slice(0, strong.length ? 3 : 5) : [];

  // Nothing in the index for this need → search Instagram live (free worker, cached and capped).
  const indexStrong = query.trim() && qvec ? rankReels(query, qvec, items, data).some((h) => h.relevance >= MATCH_MIN) : true;
  useEffect(() => {
    if (!LIVE_URL || !query.trim() || !qvec || indexStrong || live.q === query) return;
    setLive({ q: query, items: [], state: 'searching' });
    liveSearch(query, data)
      .then((r) => setLive({ q: query, items: r.items, state: 'done', note: r.note }))
      .catch(() => setLive({ q: query, items: [], state: 'done', note: 'live search unavailable' }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, qvec, indexStrong]);

  const feed = query.trim() ? shownReels.map((h) => h.item) : items;
  useEffect(() => {
    if (!feed.length) setActive(null);
    else if (!active || !feed.some((f) => f.key === active)) setActive(feed[0].key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [feed.map((f) => f.key).join('|')]);
  const onActive = useCallback((k: string) => setActive(k), []);
  // From a result card: play it, and on narrow screens bring the phone into view.
  const watch = (k: string) => {
    setActive(k);
    if (innerWidth < 834) document.querySelector('.phone-col')?.scrollIntoView({ behavior: 'smooth' });
  };

  const submit = (q: string) => {
    setQuery(q.trim());
    box.current?.blur();
  };
  const searching = !!query.trim();
  const discoveryConnected = !!data.discovery && [data.discovery.stats.apify, data.discovery.stats.graph].some((s) => s === 'ok' || s.startsWith('ok ·') || s.startsWith('partial:'));

  const rising = useMemo(
    () => data.repos.map((r, i) => ({ r, i })).filter(({ r }) => (r.mo.d7 ?? 0) > 0 && !r.a).sort((a, b) => (b.r.mo.d7 ?? 0) - (a.r.mo.d7 ?? 0)).slice(0, 12),
    [data],
  );

  return (
    <>
      <section className="stage-hero">
        <div className="wrap stage-grid">
          <div className="ask">
            <p className="eyebrow">Find the reel. Then the repo.</p>
            <h1 className={`ask-title${searching ? ' small' : ''}`}>{searching ? 'Your answer, as a reel' : <>What are you<br />trying to build?</>}</h1>
            <form className="ask-box" onSubmit={(e) => (e.preventDefault(), submit(draft))} role="search">
              <textarea
                ref={box}
                value={draft}
                rows={searching ? 1 : 3}
                onChange={(e) => setDraft(e.target.value)}
                onFocus={warm}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    submit(draft);
                  }
                }}
                placeholder="Describe your problem in your own words, e.g. “I want an AI that applies to jobs in Pune for me”"
                aria-label="Describe your problem"
              />
              <div className="ask-bar">
                {searching && <button type="button" className="link" onClick={() => (setDraft(''), setQuery(''))}>Clear</button>}
                <span className={`mode${modelP >= 1 ? ' on' : ''}`}>{modelP >= 1 ? '● understands meaning' : modelP > 0 ? `loading language model ${Math.round(modelP * 100)}%` : ''}</span>
                <button className="btn primary" disabled={!draft.trim()}>Find the reel</button>
              </div>
            </form>
            {!searching && (
              <div className="chips">
                {EXAMPLES.map((e) => (
                  <button key={e} className="chip" onClick={() => (setDraft(e), submit(e))}>{e}</button>
                ))}
              </div>
            )}

          </div>

          <div className="answer-col">
            <AnimatePresence mode="wait">
              {searching ? (
                <motion.div key={`r-${query}`} className="answers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  {repos && <Understood facets={repos.facets} labels={data.ranking.labels} />}
                  {live.q === query && live.state === 'searching' && <div className="live-status"><i className="spin" aria-hidden="true" /> Searching Instagram for fresh reels on this…</div>}
                  {live.q === query && live.state === 'done' && live.note && <p className="fine">Live search: {live.note}</p>}
                  {pool.length === 0 ? (
                    <div className="empty-note">
                      <b>No reels found for this yet.</b> {discoveryConnected ? 'Discovery runs daily; no matching reels have been indexed yet.' : 'Automated discovery is not connected on this deployment.'}{LIVE_URL ? '' : ' Live search is not enabled.'} Here are the repos that fit:
                    </div>
                  ) : strong.length ? (
                    <h3 className="answers-h">{strong.length} reel{strong.length > 1 ? 's' : ''} for this</h3>
                  ) : (
                    <div className="empty-note">{shownReels.length ? 'No reel covers this exactly yet. Here are the closest reels, and the repos that fit below.' : 'No reel covers this yet. The repository matches are below.'}</div>
                  )}
                  {shownReels.map((h, n) => (
                    <ReelResult key={h.item.key} it={h.item} data={data} n={n} active={h.item.key === active} onWatch={() => watch(h.item.key)} onDetails={onOpen} />
                  ))}
                  {repoOnly.length > 0 && (
                    <>
                      <h3 className="answers-h">{strong.length ? 'More repos for this · no reel yet' : 'Repos for this'}</h3>
                      <div className="result-list">
                        {repoOnly.map((x, k) => (
                          <RepoCard key={data.repos[x.i].n} r={data.repos[x.i]} data={data} why={x.why} index={k} onOpen={() => onOpen(x.i)} compact />
                        ))}
                      </div>
                    </>
                  )}
                </motion.div>
              ) : (
                <motion.div key="latest" className="answers" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.18 }}>
                  {items.length > 0 ? (
                    <>
                      <h3 className="answers-h">Latest reels</h3>
                      {items.slice(0, 4).map((it, n) => (
                        <ReelResult key={it.key} it={it} data={data} n={n} active={it.key === active} onWatch={() => watch(it.key)} onDetails={onOpen} />
                      ))}
                    </>
                  ) : (
                    <p className="fine">{compact(data.repos.length)} repositories indexed and refreshed daily. {discoveryConnected ? 'Reel discovery is connected.' : 'Reel discovery is not connected yet. You can add a reel yourself.'}</p>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <aside className={`phone-col${searching && !feed.length ? ' no-reels' : ''}`}>
            <Phone searching={searching} items={feed} data={data} activeKey={active} onActive={onActive} autoplay={!searching} onAdd={() => setAdding(true)} />
            <button className="link add-reel" onClick={() => setAdding(true)}>Know a reel we missed? Add it</button>
          </aside>
        </div>
      </section>

      {!searching && (
        <>
          <section className="tile dark">
            <div className="wrap">
              <p className="eyebrow on-dark">Rising this week</p>
              <h2>Repos creators will be talking about next.</h2>
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
          <section className="tile parchment">
            <div className="wrap split">
              <div>
                <p className="eyebrow">Saw a reel somewhere?</p>
                <h2>Snap it. Get the repo.</h2>
                <p className="lead muted">Drop a screenshot of the frame that shows the repo name. OCR runs in your browser and finds the exact repository, with no DMs and no "comment REPO".</p>
                <a className="btn primary" href="#/snap">Snap a reel</a>
              </div>
              <div>
                <p className="eyebrow">Creator trust, explained</p>
                <h2>Proof has to be earned.</h2>
                <p className="lead muted">{compact(data.creators.gates.min_followers)}+ followers and regular repo posts are required for a creator badge. Repository health and available engagement counts contribute to trust.</p>
                <a className="btn secondary" href="#/creators">How creators are vetted</a>
              </div>
            </div>
          </section>
        </>
      )}
      <AddReel data={data} open={adding} onClose={() => setAdding(false)} onChange={() => setVersion((v) => v + 1)} />
    </>
  );
}

function Understood({ facets, labels }: { facets: Facets; labels: Record<string, string> }) {
  const chips = [
    ...facets.categories.map((c) => labels[c] ?? c),
    ...facets.platforms.map((p) => p[0].toUpperCase() + p.slice(1)),
    ...facets.ai.map((a) => `works with ${aiLabel(a)}`),
    ...(facets.language ? [facets.language] : []),
    ...(facets.location ? [`📍 ${facets.location}`] : []),
  ];
  if (!chips.length) return null;
  return (
    <div className="understood">
      <span className="label">Understood</span>
      {chips.map((c) => <span key={c} className="chip static">{c}</span>)}
    </div>
  );
}
