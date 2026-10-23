import { useEffect, useRef, useState } from 'react';
import type { Data } from '../lib/data';
import { ago, compact } from '../lib/format';
import type { ReelItem } from '../lib/reels';

/* A phone that scrolls reels like Instagram does: vertical, one reel per screen, snapping.
   The reel in view loads Instagram's official embed; every slide carries a bottom bar with the
   repo the reel is about and a direct "Open repo" link. Idle feeds advance on their own. */

export default function Phone({
  items, data, activeKey, onActive, autoplay, onAdd, searching = false,
}: {
  items: ReelItem[];
  data: Data;
  activeKey: string | null;
  onActive: (key: string) => void;
  autoplay: boolean;
  onAdd: () => void;
  searching?: boolean;
}) {
  const screen = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState<Set<string>>(new Set());
  const [hover, setHover] = useState(false);
  const fromScroll = useRef(false);
  const index = Math.max(0, items.findIndex((i) => i.key === activeKey));

  // External selection (a result card) → scroll the phone to that reel and load it.
  useEffect(() => {
    if (fromScroll.current) {
      fromScroll.current = false;
      return;
    }
    const root = screen.current;
    const el = root?.querySelector<HTMLElement>(`[data-key="${CSS.escape(activeKey ?? '')}"]`);
    if (root && el) {
      // Scroll the phone only; scrollIntoView also moves the outer document on idle advance.
      const top = root.scrollTop + el.getBoundingClientRect().top - root.getBoundingClientRect().top - root.clientTop;
      root.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
  }, [activeKey]);

  // Scrolling inside the phone → the snapped reel becomes active.
  useEffect(() => {
    const root = screen.current;
    if (!root) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting && e.intersectionRatio > 0.6) {
            const key = (e.target as HTMLElement).dataset.key!;
            if (key !== activeKey) {
              fromScroll.current = true;
              onActive(key);
            }
          }
        }
      },
      { root, threshold: [0.6] },
    );
    root.querySelectorAll('[data-key]').forEach((n) => io.observe(n));
    return () => io.disconnect();
  }, [items, activeKey, onActive]);

  // Idle feed: advance every 7 s unless the visitor is interacting or a reel is playing.
  useEffect(() => {
    if (!autoplay || hover || items.length < 2 || (activeKey && loaded.has(activeKey))) return;
    const t = setTimeout(() => onActive(items[(index + 1) % items.length].key), 7000);
    return () => clearTimeout(t);
  }, [autoplay, hover, items, index, activeKey, loaded, onActive]);

  const play = (key: string) => setLoaded((s) => new Set(s).add(key));
  const step = (d: number) => items.length && onActive(items[(index + d + items.length) % items.length].key);

  return (
    <div className="phone-wrap" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <div className="phone" aria-label="Reels">
        <div className="phone-status" aria-hidden="true">
          <span>9:41</span>
          <i className="island" />
          <span className="sig">●●● ▮</span>
        </div>
        <div className="phone-top" aria-hidden="true">
          <b>Reels</b>
          <span>{items.length ? `${index + 1} / ${items.length}` : ''}</span>
        </div>
        <div className="phone-screen" ref={screen}>
          {items.length === 0 && (
            <div className="slide empty">
              <div>
                <span className="empty-glyph" aria-hidden="true">▶</span>
                <b>{searching ? 'No matching reel yet' : 'No reels indexed yet'}</b>
                <p>{searching ? 'Try another search, or open one of the matching repositories.' : 'Search the repository catalog, or add a reel you know. Connected discovery sources add reels after a successful pipeline run.'}</p>
                <button className="link on-dark" onClick={onAdd}>Know a reel? Add it</button>
              </div>
            </div>
          )}
          {items.map((it) => {
            const repo = it.repoRow !== undefined ? data.repos[it.repoRow] : undefined;
            const isOn = it.key === activeKey;
            const show = isOn && loaded.has(it.key);
            return (
              <section key={it.key} className={`slide${isOn ? ' on' : ''}`} data-key={it.key}>
                <div className="slide-media">
                  {show ? (
                    <iframe
                      title={`Reel by @${it.creator}`}
                      src={`https://www.instagram.com/reel/${it.shortcode}/embed/`}
                      allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
                      loading="lazy"
                    />
                  ) : (
                    <button className="poster" onClick={() => play(it.key)} aria-label={`Play reel by @${it.creator}`}>
                      <span className="poster-play" aria-hidden="true">▶</span>
                      <span className="poster-meta">
                        <b>@{it.creator}</b>
                        <small>{ago(it.posted)}{it.badge === 'top' ? ' · Top creator' : it.badge === 'verified' ? ' · Verified' : it.badge === 'local' ? ' · added by you' : it.badge === 'live' ? ' · live result' : ''}</small>
                        {it.caption && <em>{it.caption.slice(0, 120)}</em>}
                      </span>
                    </button>
                  )}
                </div>
                <div className="slide-repo">
                  {repo ? (
                    <>
                      <img className="avatar" src={`https://github.com/${repo.n.split('/')[0]}.png?size=64`} alt="" width="32" height="32" loading="lazy" />
                      <span className="sr-text">
                        <b>{repo.n.split('/')[1]}</b>
                        <small>★ {compact(repo.s)}{repo.mo.d7 ? ` · +${compact(Math.max(0, repo.mo.d7))}/wk` : ''}</small>
                      </span>
                      <a className="btn primary small" href={`https://github.com/${repo.n}`} target="_blank" rel="noreferrer">Open repo</a>
                    </>
                  ) : it.repo ? (
                    <>
                      <span className="sr-text"><b>{it.repo.split('/')[1]}</b><small>{it.repo.split('/')[0]}</small></span>
                      <a className="btn primary small" href={`https://github.com/${it.repo}`} target="_blank" rel="noreferrer">Open repo</a>
                    </>
                  ) : (
                    <span className="sr-text"><small>Repo not identified yet</small></span>
                  )}
                </div>
              </section>
            );
          })}
        </div>
        <i className="home-bar" aria-hidden="true" />
      </div>
      {items.length > 1 && (
        <div className="phone-nav">
          <button className="icon-btn" onClick={() => step(-1)} aria-label="Previous reel">↑</button>
          <button className="icon-btn" onClick={() => step(1)} aria-label="Next reel">↓</button>
        </div>
      )}
    </div>
  );
}
