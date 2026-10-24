import { useState } from 'react';
import type { Data } from '../lib/data';
import { compact, pct } from '../lib/format';
import AddReel from '../components/AddReel';

const initials = (h: string) => h.replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase() || '?';

/* The Creator Hub: how creators are vetted, the creators who passed, and a way to add a reel. */
export default function Creators({ data }: { data: Data }) {
  const { creators, gates } = data.creators;
  const [adding, setAdding] = useState(false);
  const eligible = creators.filter((c) => c.eligible).sort((a, b) => b.trust - a.trust);
  const pending = creators.filter((c) => !c.eligible);
  const linked = data.reels.reels.filter((r) => r.repo).length;
  const w = { accuracy: 0.35, consistency: 0.25, engagement: 0.2, recency: 0.2 };
  return (
    <>
      <section className="tile light page">
        <div className="wrap">
          <p className="eyebrow pill">Creator Hub</p>
          <h1 className="h-lg">Proof has to be earned.<br /><span className="grad">The Vetted Creator Network.</span></h1>
          <p className="lead">Reels are linked to repositories even while a creator is pending. Creator badges require the thresholds below; trust is recomputed on each pipeline run.</p>
          <div className="hub-stats">
            <div><small>Vetted creators</small><b>{eligible.length}</b><span>passed every gate</span></div>
            <div><small>Pending review</small><b>{pending.length}</b><span>found, not yet eligible</span></div>
            <div><small>Reels indexed</small><b>{data.reels.reels.length}</b><span>{linked} linked to a repo</span></div>
            <div><small>Follower gate</small><b>{compact(gates.min_followers)}+</b><span>and {gates.min_posts_60d}+ repo posts in 60 days</span></div>
          </div>
          <div className="protocol">
            <span className="pi" aria-hidden="true">✓</span>
            <div><b>Verification protocol</b><p>Every repo claim is checked against GitHub: the repository must exist, be active and healthy.</p></div>
            <em>Follower threshold</em><em>Posting cadence</em><em>Repo accuracy</em><em>Recency</em>
          </div>
        </div>
      </section>

      <section className="tile dark">
        <div className="wrap">
          <div className="section-head">
            <div>
              <p className="eyebrow">Spotlight</p>
              <h2>Vetted creators <span className="grad">· {eligible.length}</span></h2>
            </div>
          </div>
          {eligible.length ? (
            <div className="spot-grid" style={{ marginTop: 24 }}>
              {eligible.map((c) => (
                <a key={c.handle} className="spot" href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noreferrer">
                  <div className="spot-head">
                    <span className="spot-ring"><span>{initials(c.handle)}</span></span>
                    <div>
                      <b>@{c.handle}</b> <span className={`trust ${c.badge === 'top' ? 'top' : 'vetted'}`}>{c.badge === 'top' ? 'Top creator' : 'Vetted'}</span>
                      <div className="muted" style={{ fontSize: 12 }}>{c.niche || 'repo reels'}</div>
                    </div>
                    <div className="spot-score"><b>{Math.round(c.trust * 100)}</b><small>TRUST</small></div>
                  </div>
                  <div className="spot-kpis">
                    <div><small>Followers</small><b>{compact(c.followers)}</b></div>
                    <div><small>Reels indexed</small><b>{c.reels}</b></div>
                    <div><small>Posts · 60d</small><b>{c.posts_60d}</b></div>
                  </div>
                  <div className="bars">
                    {(['accuracy', 'consistency', 'engagement', 'recency'] as const).map((k) => (
                      <span key={k} title={`${k} ${pct(c[k])}`}>
                        <i style={{ width: pct(c[k]) }} />
                        <em>{k}</em>
                      </span>
                    ))}
                  </div>
                </a>
              ))}
            </div>
          ) : (
            <div className="empty-note" style={{ marginTop: 24 }}>
              <p>No creators have earned a badge yet. Connected discovery finds creators from matched reels; each pipeline run checks available follower counts, posting history and repository health.</p>
            </div>
          )}
          {pending.length > 0 && (
            <>
              <h3 className="answers-h" style={{ marginTop: 32 }}>Pending <small>{pending.length}</small></h3>
              <ul className="pending">
                {pending.map((c) => (
                  <li key={c.handle}><b>@{c.handle}</b> {c.reasons.join('; ')}</li>
                ))}
              </ul>
            </>
          )}
        </div>
      </section>

      <section className="tile light">
        <div className="wrap">
          <div className="claim">
            <div>
              <p className="eyebrow">Submit or claim a reel</p>
              <h2>Know a reel we <span className="grad">missed?</span></h2>
              <p className="lead">Paste the Instagram link and the repo it shows. It is indexed in your browser straight away, and can be exported for the shared catalog.</p>
              <button className="btn primary" onClick={() => setAdding(true)}>Add a reel</button>
            </div>
            <div className="formula">
              <code>trust = {w.accuracy}·accuracy + {w.consistency}·consistency + {w.engagement}·engagement + {w.recency}·recency</code>
              <ul>
                <li><b>Accuracy</b>: the share of their repo claims that point to a real, active, healthy repository.</li>
                <li><b>Consistency</b>: how regularly they post about repos.</li>
                <li><b>Engagement</b>: likes and comments per view, when those counts are available.</li>
                <li><b>Recency</b>: recent posts count more.</li>
              </ul>
            </div>
          </div>
          <div className="info-grid" style={{ marginTop: 20 }}>
            <div><i>▶</i><b>Official embeds only</b><p>Reels play through Instagram's official embed. Nothing is re-hosted.</p></div>
            <div><i>⚙</i><b>Calculated, not granted</b><p>Badges are calculated signals, not a manual identity or account-type verification.</p></div>
            <div><i>✕</i><b>Opt out any time</b><p>Creators can request removal through our GitHub repository.</p></div>
          </div>
        </div>
      </section>
      <AddReel data={data} open={adding} onClose={() => setAdding(false)} onChange={() => {}} />
    </>
  );
}
