import type { Data } from '../lib/data';
import { compact, pct } from '../lib/format';

/* How creators are vetted, and the current list with every trust component visible. */
export default function Creators({ data }: { data: Data }) {
  const { creators, gates } = data.creators;
  const eligible = creators.filter((c) => c.eligible);
  const pending = creators.filter((c) => !c.eligible);
  const w = { accuracy: 0.35, consistency: 0.25, engagement: 0.2, recency: 0.2 };
  return (
    <>
      <section className="tile parchment page">
        <div className="wrap narrow">
          <p className="eyebrow">Creators</p>
          <h1 className="h-lg">Proof has to be earned.</h1>
          <p className="lead muted">Reels are linked to repositories even while a creator is pending. Creator badges require the follower and posting thresholds below; trust is recomputed on each pipeline run.</p>
          <div className="gates">
            <div><b>{compact(gates.min_followers)}+</b><span>followers</span></div>
            <div><b>{gates.min_posts_60d}+</b><span>repo posts in 60 days</span></div>
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
      </section>
      <section className="tile light">
        <div className="wrap narrow">
          <h2 className="h-md">Vetted creators · {eligible.length}</h2>
          {eligible.length ? (
            <div className="creator-table">
              {eligible.map((c) => (
                <a key={c.handle} className="creator-line" href={`https://www.instagram.com/${c.handle}/`} target="_blank" rel="noreferrer">
                  <div className="who">
                    <b>@{c.handle}</b>
                    <span>{compact(c.followers)} followers · {c.reels} reels indexed{c.niche ? ` · ${c.niche}` : ''}</span>
                  </div>
                  <span className={`trust ${c.badge}`}>{c.badge === 'top' ? 'Top creator' : 'Verified'}</span>
                  <div className="bars">
                    {(['accuracy', 'consistency', 'engagement', 'recency'] as const).map((k) => (
                      <span key={k} title={`${k} ${pct(c[k])}`}>
                        <i style={{ width: pct(c[k]) }} />
                        <em>{k}</em>
                      </span>
                    ))}
                  </div>
                  <b className="score">{Math.round(c.trust * 100)}</b>
                </a>
              ))}
            </div>
          ) : (
            <div className="empty-note">
              <p>No creators have earned a badge yet. Connected discovery finds creators from matched reels; each pipeline run checks available follower counts, posting history and repository health.</p>
            </div>
          )}
          {pending.length > 0 && (
            <>
              <h3 className="h-sm">Pending · {pending.length}</h3>
              <ul className="pending">
                {pending.map((c) => (
                  <li key={c.handle}><b>@{c.handle}</b> {c.reasons.join('; ')}</li>
                ))}
              </ul>
            </>
          )}
          <p className="fine">Reels play through Instagram's official embed. Optional discovery uses Apify to collect public post metadata; follower counts can also come from Meta's Business Discovery API. Badges are calculated signals, not a manual identity or account-type verification. Creators can request removal through our GitHub repository.</p>
        </div>
      </section>
    </>
  );
}
