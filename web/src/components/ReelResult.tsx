import { motion } from 'motion/react';
import type { Data } from '../lib/data';
import { ago, compact } from '../lib/format';
import type { ReelItem } from '../lib/reels';

/* One reel answer: who posted it, what it says, and the repo it mentions, with
   "Watch" (plays it in the phone) and "Open repo" (straight to GitHub). */
export default function ReelResult({ it, data, n, active, onWatch, onDetails }: { it: ReelItem; data: Data; n: number; active: boolean; onWatch: () => void; onDetails: (row: number) => void }) {
  const repo = it.repoRow !== undefined ? data.repos[it.repoRow] : undefined;
  return (
    <motion.article
      className={`reel-result${active ? ' active' : ''}`}
      layout="position"
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.4, delay: Math.min(n, 6) * 0.04 }}
      onClick={onWatch}
    >
      <span className="rr-n"><img src={`https://github.com/${(it.repo ?? 'github').split('/')[0]}.png?size=80`} alt="" width="36" height="36" /></span>
      <div className="rr-body">
        <div className="rr-who">
          <b>@{it.creator}</b>
          {it.badge === 'top' && <span className="trust top">Top creator</span>}
          {it.badge === 'verified' && <span className="trust">Verified</span>}
          {it.badge === 'local' && <span className="trust">Added by you</span>}
          {it.badge === 'live' && <span className="trust live">Live from Instagram</span>}
          {it.badge === 'pending' && <span className="trust">New creator</span>}
          <span className="muted">{ago(it.posted)}</span>
        </div>
        {it.caption && <p className="rr-caption">“{it.caption.slice(0, 180)}{it.caption.length > 180 ? '…' : ''}”</p>}
        {repo ? (
          <div className="rr-repo">
            <img className="avatar" src={`https://github.com/${repo.n.split('/')[0]}.png?size=64`} alt="" width="28" height="28" loading="lazy" />
            <span>
              <b>{repo.n}</b>
              <small>{repo.d.slice(0, 110)}</small>
              <small className="rr-facts">★ {compact(repo.s)}{repo.mo.d7 ? ` · +${compact(Math.max(0, repo.mo.d7))} this week` : ''} · pushed {ago(repo.p)}{repo.lic ? ` · ${repo.lic}` : ''}</small>
            </span>
          </div>
        ) : it.repo ? (
          <div className="rr-repo"><span><b>{it.repo}</b><small>Not in our catalog yet</small></span></div>
        ) : null}
        <div className="rr-actions" onClick={(e) => e.stopPropagation()}>
          <button className={`btn small ${active ? 'secondary' : 'primary'}`} onClick={onWatch}>{active ? 'Selected in phone' : '▶ Watch reel'}</button>
          {(repo || it.repo) && <a className="btn small secondary" href={`https://github.com/${repo?.n ?? it.repo}`} target="_blank" rel="noreferrer">Open repo ↗</a>}
          {repo && it.repoRow !== undefined && <button className="link" onClick={() => onDetails(it.repoRow!)}>Repo details</button>}
          <a className="link" href={it.url} target="_blank" rel="noreferrer">Instagram ↗</a>
        </div>
      </div>
    </motion.article>
  );
}
