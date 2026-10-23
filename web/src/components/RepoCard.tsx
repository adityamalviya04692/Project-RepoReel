import { motion } from 'motion/react';
import type { Data, Repo } from '../lib/data';
import HealthStrip from './HealthStrip';
import ReelEmbed from './ReelEmbed';

/* A result: what the repo is, why it matches, how healthy it is, and creator reels as proof. */
export default function RepoCard({ r, data, why, onOpen, index = 0, compact = false }: { r: Repo; data: Data; why?: string[]; onOpen: () => void; index?: number; compact?: boolean }) {
  const [owner, name] = r.n.split('/');
  const reels = data.reelsByRepo.get(r.n.toLowerCase()) ?? [];
  return (
    <motion.article
      className={`repo-card${compact ? ' compact' : ''}`}
      layout="position"
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ type: 'spring', bounce: 0, duration: 0.45, delay: Math.min(index, 6) * 0.05 }}
    >
      <header>
        <img className="avatar" src={`https://github.com/${owner}.png?size=88`} alt="" width="44" height="44" loading="lazy" />
        <div className="title">
          <h3>{name}</h3>
          <span className="owner">{owner}</span>
        </div>
        <button className="btn secondary small" onClick={onOpen}>Details</button>
      </header>
      {why && why.length > 0 && (
        <p className="why">
          <span>Matches</span> {why.slice(0, 4).join(' · ')}
        </p>
      )}
      <p className="desc">{r.d || r.x.slice(0, 180)}</p>
      <HealthStrip r={r} />
      {compact ? null : reels.length > 0 ? (
        <div className="reels-row">
          {reels.slice(0, 3).map((rl) => (
            <ReelEmbed key={rl.url} reel={rl} creator={data.creatorByHandle.get(rl.creator)} />
          ))}
        </div>
      ) : (
        <p className="proof-empty">
          No reels indexed yet
          {r.hn ? (
            <>
              {' · '}
              <a href={r.hn.url} target="_blank" rel="noreferrer">discussed on Hacker News ({r.hn.points} points) ↗</a>
            </>
          ) : null}
        </p>
      )}
    </motion.article>
  );
}
