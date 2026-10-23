import { useEffect, useRef, useState } from 'react';
import type { Creator, Reel } from '../lib/data';
import { ago, compact } from '../lib/format';

/* A reel is shown with Instagram's official embed, loaded only when the user asks to play it
   (keeps the page fast and avoids loading third-party scripts until needed). */

declare global {
  interface Window {
    instgrm?: { Embeds: { process: () => void } };
  }
}

let script: Promise<void> | null = null;
function loadEmbedJs(): Promise<void> {
  return (script ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://www.instagram.com/embed.js';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('embed.js failed to load'));
    document.body.appendChild(s);
  }));
}

export default function ReelEmbed({ reel, creator }: { reel: Reel; creator?: Creator }) {
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!playing) return;
    loadEmbedJs()
      .then(() => window.instgrm?.Embeds.process())
      .catch(() => setFailed(true));
  }, [playing]);
  return (
    <figure className="reel">
      {playing && !failed ? (
        <div ref={box} className="reel-embed">
          <blockquote className="instagram-media" data-instgrm-permalink={reel.url} data-instgrm-version="14" style={{ margin: 0, width: '100%' }}>
            <a href={reel.url} target="_blank" rel="noreferrer">View this reel on Instagram</a>
          </blockquote>
        </div>
      ) : (
        <button className="reel-frame" onClick={() => setPlaying(true)} aria-label={`Play reel by @${reel.creator}`}>
          <span className="reel-play" aria-hidden="true">▶</span>
          <span className="reel-meta">
            <b>@{reel.creator}</b>
            <small>{ago(reel.posted)}{reel.views ? ` · ${compact(reel.views)} views` : ''}</small>
          </span>
        </button>
      )}
      <figcaption>
        {creator && <span className={`trust ${creator.badge}`}>{creator.badge === 'top' ? 'Top creator' : creator.badge === 'verified' ? 'Verified' : 'Pending'} · {Math.round(creator.trust * 100)}</span>}
        <a href={reel.url} target="_blank" rel="noreferrer">Open on Instagram ↗</a>
      </figcaption>
    </figure>
  );
}
