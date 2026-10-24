import { useMemo, useState } from 'react';
import type { Data } from '../lib/data';
import { ago, compact, pct } from '../lib/format';

/* The data-engineering view: freshness, per-stage timings and row counts, quality checks,
   retrieval evaluation, lineage and run history. */
export default function PipelinePage({ data, onOpen }: { data: Data; onOpen: (row: number) => void }) {
  const p = data.pipeline;
  if (!p) return <><Trending data={data} onOpen={onOpen} /><section className="tile light"><div className="wrap narrow"><p className="empty-note">No pipeline run has been published yet.</p></div></section></>;
  const L = p.last;
  const max = Math.max(...L.stages.map((s) => s.seconds));
  const hoursOld = (Date.now() - Date.parse(L.finished)) / 36e5;
  return (
    <>
      <Trending data={data} onOpen={onOpen} />
      <section className="tile dark">
        <div className="wrap">
          <p className="eyebrow on-dark">Pipeline status</p>
          <h2>Refreshed <span className="grad">{ago(L.finished)}.</span></h2>
          <p className="lead muted-on-dark">A scheduled GitHub Actions job ingests GitHub, Hacker News and connected reel sources, transforms it bronze → silver → gold with DuckDB, embeds every repository, checks quality, evaluates retrieval and publishes static files for this site.</p>
          <div className="kpis">
            <div><b>{compact(L.catalog)}</b><span>repositories</span></div>
            <div><b>{L.snapshot_days}</b><span>days of star snapshots</span></div>
            <div><b>{Math.round(L.seconds / 60)}m</b><span>last run</span></div>
            <div><b>{pct(L.eval.hit3)}</b><span>hit@3 · {L.eval.queries} golden queries</span></div>
            <div><b>{L.eval.mrr.toFixed(2)}</b><span>MRR</span></div>
            <div className={hoursOld > 26 ? 'stale' : ''}><b>{hoursOld > 26 ? 'stale' : 'fresh'}</b><span>SLO: under 26 h</span></div>
          </div>
        </div>
      </section>
      <section className="tile light">
        <div className="wrap">
          <h2 className="h-md">Reel discovery</h2>
          <Discovery data={data} />
          <h2 className="h-md">Lineage</h2>
          <Lineage />
          <h2 className="h-md">Stages</h2>
          <div className="stages">
            {L.stages.map((s) => (
              <div key={s.name} className="stage">
                <span className="stage-name">{s.name}</span>
                <span className="stage-bar"><i style={{ width: `${Math.max(1.5, (s.seconds / max) * 100)}%` }} /></span>
                <span className="stage-time">{s.seconds < 60 ? `${s.seconds.toFixed(1)}s` : `${(s.seconds / 60).toFixed(1)}m`}</span>
                <span className="stage-rows">{s.rows ? Object.entries(s.rows).map(([k, v]) => `${k.replace(/_/g, ' ')} ${typeof v === 'number' && v < 1 && v > 0 ? v.toFixed(2) : compact(v)}`).join(' · ') : ''}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
      <section className="tile parchment">
        <div className="wrap split">
          <div>
            <h2 className="h-md">Quality checks</h2>
            <ul className="checks">
              {L.checks.map((c) => (
                <li key={c.name} className={c.status}>
                  <b>{c.name}</b>
                  <span>{c.detail}</span>
                </li>
              ))}
            </ul>
            {data.reels.review.length > 0 && (
              <>
                <h3 className="h-sm">Review queue · {data.reels.review.length}</h3>
                <ul className="checks">
                  {data.reels.review.map((r) => (
                    <li key={r.url} className="warn"><b>{r.candidate}</b><span>{Math.round(r.confidence * 100)}% · {r.url}</span></li>
                  ))}
                </ul>
              </>
            )}
          </div>
          <div>
            <h2 className="h-md">Retrieval evaluation</h2>
            <p className="muted small">Plain-language needs with the repos a good answer should rank highly, scored on every run.</p>
            <ul className="evals">
              {L.eval.rows.map((r) => (
                <li key={r.query} className={r.first_hit === 1 ? 'hit' : r.first_hit && r.first_hit <= 3 ? 'near' : 'miss'}>
                  <span className="rankpos">{r.first_hit ? `#${r.first_hit}` : '—'}</span>
                  <span>
                    <b>{r.query}</b>
                    <small>expected {r.expect[0]} · got {r.top3.map((t) => t.split('/')[1]).join(', ')}</small>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>
      <section className="tile light">
        <div className="wrap narrow">
          <h2 className="h-md">Recent runs</h2>
          <div className="runs">
            {p.history.slice().reverse().map((h) => (
              <div key={h.finished}><span>{new Date(h.finished).toLocaleString()}</span><span>{compact(h.catalog)} repos</span><span>{Math.round(h.seconds / 60)} min</span></div>
            ))}
          </div>
        </div>
      </section>
    </>
  );
}

function Lineage() {
  const col = (x: number, title: string, items: string[], tone = '') => (
    <g transform={`translate(${x} 0)`}>
      <text x="0" y="14" className="lin-h">{title}</text>
      {items.map((t, i) => (
        <g key={t} transform={`translate(0 ${28 + i * 40})`}>
          <rect width="172" height="30" rx="8" className={`lin-box ${tone}`} />
          <text x="12" y="20" className="lin-t">{t}</text>
        </g>
      ))}
    </g>
  );
  return (
    <svg className="lineage" viewBox="0 0 980 220" role="img" aria-label="Data lineage from sources through bronze, silver and gold layers to the site">
      {[180, 380, 580, 780].map((x) => <path key={x} d={`M${x} 110 h24`} className="lin-arrow" markerEnd="url(#arr)" />)}
      <defs><marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0 10 5 0 10z" className="lin-head" /></marker></defs>
      {col(0, 'Sources', ['GitHub Search', 'GitHub GraphQL', 'Hacker News', 'creators/reels.yaml'])}
      {col(204, 'Bronze · raw JSONL', ['search hits', 'repo metadata + README', 'HN stories', 'curated rows'])}
      {col(404, 'Silver · DuckDB', ['repos', 'star snapshots', 'reel ↔ repo matches', 'creators'])}
      {col(604, 'Gold · static files', ['catalog + embeddings', 'trends & health', 'creator trust', 'pipeline report'], 'gold')}
      {col(804, 'Site', ['search', 'repo sheet', 'snap a reel', 'this page'], 'site')}
    </svg>
  );
}

function Discovery({ data }: { data: Data }) {
  const d = data.discovery;
  if (!d) return <p className="muted small">Discovery has not run yet.</p>;
  const b = d.stats.budget;
  return (
    <>
      <div className="discovery">
        <div><b>{d.shown_reels}</b><span>English repo reels shown{d.matched_reels != null ? ` · ${d.matched_reels} with the repo identified` : ''}</span></div>
        <div><b>{d.history_reels}</b><span>repo reels kept in history</span></div>
        <div><b>{d.stats.repo_creators ?? '—'}</b><span>repo creators whose feeds are read{d.stats.backfilled_creators ? ` · ${d.stats.backfilled_creators} with full history` : ''}{d.stats.candidates ? ` · ${d.stats.candidates} tagged creators to check` : ''}</span></div>
        <div><b>{d.stats.fetched}</b><span>fetched in the last run{d.stats.kept != null ? ` · ${d.stats.kept} new repo reels` : ''}</span></div>
        <div><b>{b ? `$${b.used.toFixed(2)}` : '—'}</b><span>{b ? `Apify monthly usage (cap $${b.plan_cap.toFixed(2)})${d.stats.allowance ? ` · ${d.stats.allowance} results today` : ''}` : 'free credit usage'}</span></div>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        Apify (free plan): {d.stats.apify} · Graph Business Discovery: {d.stats.graph}{d.stats.graph_hashtags && d.stats.graph_hashtags !== 'not configured' ? ` · Graph hashtags: ${d.stats.graph_hashtags}` : ''}
        {d.stats.rejected ? ` · rejected ${d.stats.rejected.not_english} not in English, ${d.stats.rejected.off_topic} not about a repo` : ''}
        {d.stats.ocr ? ` · ${d.stats.ocr} covers read with OCR` : ''}
        {d.stats.replay ? ' · replayed from bronze' : d.stats.resumed ? ' · resumed from retained bronze' : ''}
      </p>
      {d.stats.topics.length > 0 && (
        <div className="topics-today">
          {d.stats.topics.map((t) => <span key={t.q}>{t.kind === 'hashtag' ? '#' : ''}{t.q} · {t.reels}{t.kept != null ? ` → ${t.kept} kept` : ''}</span>)}
        </div>
      )}
    </>
  );
}

/* Breakout leaderboard: catalog repos ranked by stars gained in the last 7 days, from daily snapshots. */
function Trending({ data, onOpen }: { data: Data; onOpen: (row: number) => void }) {
  const [cat, setCat] = useState('');
  const movers = useMemo(() => data.repos.map((r, i) => ({ r, i })).filter(({ r }) => (r.mo.d7 ?? 0) > 0 && !r.a).sort((a, b) => (b.r.mo.d7 ?? 0) - (a.r.mo.d7 ?? 0)), [data]);
  const cats = useMemo(() => {
    const m = new Map<string, number>();
    for (const { r } of movers) for (const c of r.cat) m.set(c, (m.get(c) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7);
  }, [movers]);
  const sum = (key: (r: Data['repos'][number]) => string[]) => {
    const m = new Map<string, number>();
    for (const { r } of movers) for (const k of key(r)) if (k) m.set(k, (m.get(k) ?? 0) + (r.mo.d7 ?? 0));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  };
  const langs = useMemo(() => sum((r) => [r.l]), [movers]); // eslint-disable-line react-hooks/exhaustive-deps
  const topics = useMemo(() => sum((r) => r.cat), [movers]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = (cat ? movers.filter(({ r }) => r.cat.includes(cat)) : movers).slice(0, 12);
  const vmax = Math.max(1, ...rows.map(({ r }) => r.mo.d7 ?? 0));
  const label = (c: string) => data.ranking.labels[c] ?? c;
  const gained = movers.reduce((a, { r }) => a + (r.mo.d7 ?? 0), 0);
  return (
    <section className="tile light page">
      <div className="wrap">
        <div className="section-head">
          <div>
            <p className="eyebrow pill">Trending pipeline</p>
            <h1 className="h-lg">Repos creators will be talking <span className="grad">about next.</span></h1>
            <p className="lead">Ranked by stars gained in the last 7 days, measured from daily snapshots of the catalog. Values marked * are estimated from a new repo's age.</p>
          </div>
          <div className="hub-stats" style={{ gridTemplateColumns: 'repeat(2, minmax(140px, 1fr))', marginTop: 0 }}>
            <div><small>Rising repos</small><b>{movers.length.toLocaleString()}</b><span>gained stars this week</span></div>
            <div><small>Stars gained</small><b>{compact(gained)}</b><span>across the catalog · 7d</span></div>
          </div>
        </div>
        <div className="filters" role="group" aria-label="Filter by category">
          <button className={cat ? '' : 'on'} onClick={() => setCat('')}>All<em>{movers.length}</em></button>
          {cats.map(([c, n]) => <button key={c} className={cat === c ? 'on' : ''} onClick={() => setCat(c)}>{label(c)}<em>{n}</em></button>)}
        </div>
        <div className="lb-wrap">
          <table className="lb">
            <thead><tr><th>#</th><th>Repository</th><th>Reels</th><th>Stars</th><th>7-day velocity</th><th>Stack</th><th>Licence</th><th /></tr></thead>
            <tbody>
              {rows.map(({ r, i }, k) => {
                const reels = data.reelsByRepo.get(r.n.toLowerCase())?.length ?? 0;
                return (
                  <tr key={r.n}>
                    <td className="rank">{String(k + 1).padStart(2, '0')}</td>
                    <td><div className="repo"><img src={`https://github.com/${r.n.split('/')[0]}.png?size=60`} alt="" width="30" height="30" loading="lazy" /><span><b>{r.n}</b><small>{r.d}</small></span></div></td>
                    <td className="lic">{reels || '—'}</td>
                    <td className="stars">★ {compact(r.s)}</td>
                    <td className="vel">+{compact(r.mo.d7 ?? 0)}{r.mo.est ? '*' : ''}<span className="lang-track" style={{ display: 'block', width: 90, marginTop: 6 }}><i className="lang-row-i" style={{ display: 'block', height: 6, borderRadius: 3, background: 'var(--ig)', width: `${((r.mo.d7 ?? 0) / vmax) * 100}%` }} /></span></td>
                    <td className="tags">{[r.l, ...r.cat.slice(0, 1).map(label)].filter(Boolean).map((t) => <em key={t}>{t}</em>)}</td>
                    <td className="lic">{r.lic && r.lic !== 'NOASSERTION' ? r.lic : '—'}</td>
                    <td><div className="act">
                      {reels > 0 && <a className="btn small primary" href={`#/?q=${encodeURIComponent(r.n.split('/')[1])}`}>Watch</a>}
                      <button className="btn small ghost" onClick={() => onOpen(i)}>Details</button>
                      <a className="btn small secondary" href={`https://github.com/${r.n}`} target="_blank" rel="noreferrer">Open</a>
                    </div></td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="lic">No rising repos in this category yet.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="trend-panels">
          <div className="panel">
            <p className="eyebrow">Velocity by language</p>
            <h3>Top trending languages</h3>
            {langs.map(([l, v]) => (
              <div key={l} className="lang-row">
                <div><span>{l}</span><span>+{compact(v)} ★</span></div>
                <div className="lang-track"><i style={{ width: `${(v / (langs[0]?.[1] || 1)) * 100}%` }} /></div>
              </div>
            ))}
          </div>
          <div className="panel">
            <p className="eyebrow">Archetypes</p>
            <h3>What people are building</h3>
            {topics.map(([c, v], k) => (
              <div key={c} className="topic-row"><span className="n">{k + 1}</span><b>{label(c)}</b><small>+{compact(v)} ★ / wk</small></div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
