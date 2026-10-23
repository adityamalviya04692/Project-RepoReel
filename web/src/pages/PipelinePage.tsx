import type { Data } from '../lib/data';
import { ago, compact, pct } from '../lib/format';

/* The data-engineering view: freshness, per-stage timings and row counts, quality checks,
   retrieval evaluation, lineage and run history. */
export default function PipelinePage({ data }: { data: Data }) {
  const p = data.pipeline;
  if (!p) return <section className="tile light page"><div className="wrap narrow"><p className="empty-note">No pipeline run has been published yet.</p></div></section>;
  const L = p.last;
  const max = Math.max(...L.stages.map((s) => s.seconds));
  const hoursOld = (Date.now() - Date.parse(L.finished)) / 36e5;
  return (
    <>
      <section className="tile dark page">
        <div className="wrap">
          <p className="eyebrow on-dark">Pipeline status</p>
          <h1 className="h-lg">Refreshed {ago(L.finished)}.</h1>
          <p className="lead muted-on-dark">A scheduled GitHub Actions job ingests GitHub, Hacker News and curated creator data, transforms it bronze → silver → gold with DuckDB, embeds every repository, checks quality, evaluates retrieval and publishes static files for this site.</p>
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
        <div><b>{d.shown_reels}</b><span>reels linked to a repo</span></div>
        <div><b>{d.history_reels}</b><span>reels seen in the last 120 days</span></div>
        <div><b>{d.stats.fetched}</b><span>fetched in the last run</span></div>
        <div><b>{b ? `$${b.used.toFixed(2)}` : '—'}</b><span>{b ? `of the $5 free monthly credit` : 'free credit usage'}</span></div>
      </div>
      <p className="muted small" style={{ marginTop: 12 }}>
        Apify (free plan): {d.stats.apify} · Instagram Graph API: {d.stats.graph}{d.stats.replay ? ' · replayed from bronze' : ''}
      </p>
      {d.stats.topics.length > 0 && (
        <div className="topics-today">
          {d.stats.topics.map((t) => <span key={t.q}>{t.kind === 'hashtag' ? '#' : ''}{t.q} · {t.reels}</span>)}
        </div>
      )}
    </>
  );
}
