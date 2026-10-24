import { useEffect, useRef, useState } from 'react';
import { animate, motion, useMotionValue, useTransform } from 'motion/react';
import { reelsForRepo, type Data } from '../lib/data';
import { ago, compact } from '../lib/format';
import { aiLabel, similar } from '../lib/rank';
import HealthStrip from './HealthStrip';
import ReelEmbed from './ReelEmbed';

/* The repo sheet follows the pointer 1:1, projects momentum on release to decide whether to
   dismiss (Apple's projection, d = 0.998), hands the release velocity to a slightly bouncy
   spring, and rubber-bands if pulled upward past its resting point. */

const project = (v: number, d = 0.998) => ((v / 1000) * d) / (1 - d);

export default function RepoSheet({ data, row, onClose, onOpen }: { data: Data; row: number; onClose: () => void; onOpen: (row: number) => void }) {
  const r = data.repos[row];
  const [owner, name] = r.n.split('/');
  const y = useMotionValue(window.innerHeight);
  const scrim = useTransform(y, [0, window.innerHeight * 0.9], [1, 0]);
  const sheet = useRef<HTMLDivElement>(null);
  const [reels, setReels] = useState(() => data.reelsByRepo.get(r.n.toLowerCase()) ?? []);
  useEffect(() => {
    let live = true;
    setReels(data.reelsByRepo.get(r.n.toLowerCase()) ?? []);
    void reelsForRepo(r.n).then((all) => live && all.length && setReels(all)); // the full list lives in the repo's shard
    return () => {
      live = false;
    };
  }, [data, r.n]);
  const near = similar(data, row, 4);

  useEffect(() => {
    animate(y, 0, { type: 'spring', bounce: 0, duration: 0.4 });
    sheet.current?.scrollTo({ top: 0 });
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && dismiss(0);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row]);

  function dismiss(velocity: number) {
    animate(y, window.innerHeight, { type: 'spring', bounce: 0, duration: 0.35, velocity }).then(onClose);
  }

  return (
    <div className="sheet-layer" role="dialog" aria-modal="true" aria-label={`${r.n} details`}>
      <motion.div className="scrim" style={{ opacity: scrim }} onClick={() => dismiss(0)} />
      <motion.div
        className="sheet"
        style={{ y }}
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={{ top: 0.08, bottom: 1 }}
        dragMomentum={false}
        dragListener
        onDragEnd={(_, info) => {
          const projected = y.get() + project(info.velocity.y);
          if (projected > window.innerHeight * 0.3) dismiss(info.velocity.y);
          else animate(y, 0, { type: 'spring', bounce: 0.2, duration: 0.3, velocity: info.velocity.y });
        }}
      >
        <div className="grabber" aria-hidden="true" />
        <div className="sheet-body" ref={sheet} onPointerDownCapture={(e) => (sheet.current && sheet.current.scrollTop > 0 ? e.stopPropagation() : undefined)}>
          <header className="sheet-head">
            <img className="avatar lg" src={`https://github.com/${owner}.png?size=120`} alt="" width="60" height="60" />
            <div>
              <h2>{name}</h2>
              <span className="owner">{owner}</span>
            </div>
            <button className="icon-btn" onClick={() => dismiss(0)} aria-label="Close">✕</button>
          </header>
          <p className="lead">{r.d}</p>
          <HealthStrip r={r} />
          <div className="sheet-actions">
            <a className="btn primary" href={`https://github.com/${r.n}`} target="_blank" rel="noreferrer">Open on GitHub</a>
            {r.hp && <a className="btn secondary" href={r.hp} target="_blank" rel="noreferrer">Website</a>}
          </div>

          <div className="stats">
            <div><b>{compact(r.s)}</b><span>stars</span></div>
            <div><b>{r.mo.d7 != null ? `+${compact(Math.max(0, r.mo.d7))}` : '—'}</b><span>this week{r.mo.est ? '*' : ''}</span></div>
            <div><b>{r.mo.d30 != null ? `+${compact(Math.max(0, r.mo.d30))}` : '—'}</b><span>this month{r.mo.est ? '*' : ''}</span></div>
            <div><b>{Math.round(r.sc.health * 100)}</b><span>health</span></div>
          </div>
          {r.mo.est && <p className="fine">* estimated from age: this repo is new, and daily snapshots haven't built up a history yet.</p>}

          {r.x && (
            <section>
              <h4>From the README</h4>
              <p className="readme">{r.x}…</p>
            </section>
          )}

          <section>
            <h4>Creator reels</h4>
            {reels.length ? (
              <div className="reels-row">
                {reels.map((rl) => (
                  <ReelEmbed key={rl.url} reel={rl} creator={data.creatorByHandle.get(rl.creator)} />
                ))}
              </div>
            ) : (
              <p className="proof-empty">No reels are indexed for this repo yet.</p>
            )}
          </section>

          {r.hn && (
            <section>
              <h4>Discussion</h4>
              <a className="hn" href={r.hn.url} target="_blank" rel="noreferrer">
                <b>{r.hn.title}</b>
                <span>Hacker News · {r.hn.points} points · {r.hn.count} {r.hn.count === 1 ? 'story' : 'stories'} this month ↗</span>
              </a>
            </section>
          )}

          <section>
            <h4>Details</h4>
            <dl className="facts">
              <dt>Created</dt><dd>{ago(r.c)}</dd>
              <dt>Last push</dt><dd>{ago(r.p)}</dd>
              {r.rel && (<><dt>Latest release</dt><dd>{ago(r.rel)}</dd></>)}
              <dt>Forks</dt><dd>{compact(r.f)}</dd>
              {r.ai.length > 0 && (<><dt>Works with</dt><dd>{r.ai.map(aiLabel).join(', ')}</dd></>)}
            </dl>
            {r.t.length > 0 && (
              <div className="topics">
                {r.t.map((t) => <span key={t}>{t}</span>)}
              </div>
            )}
          </section>

          <section>
            <h4>Similar repos</h4>
            <div className="similar">
              {near.map((j) => (
                <button key={j} onClick={() => onOpen(j)}>
                  <b>{data.repos[j].n.split('/')[1]}</b>
                  <span>{data.repos[j].d.slice(0, 90)}</span>
                  <small>★ {compact(data.repos[j].s)}</small>
                </button>
              ))}
            </div>
          </section>
          <p className="fine">Always read a repository's code and licence before running it.</p>
        </div>
      </motion.div>
    </div>
  );
}
