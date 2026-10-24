import { useEffect, useRef, useState } from 'react';
import type { Data } from '../lib/data';
import { ago, compact } from '../lib/format';
import type { ReelItem } from '../lib/reels';

/* A phone that scrolls reels like Instagram does: vertical, one reel per screen, snapping.
   The reel in view (and the next one, preloaded) shows Instagram's official embed straight away;
   every slide carries a bottom bar with the repo and a direct "Open repo" link.
   Instagram's embed can't be autoplayed, muted or asked when a video ends, so an idle feed advances
   on a timer instead; tapping a reel plays it with sound in Instagram's own player, and a reel that
   is playing (the embed has focus) holds the feed until the visitor moves on. */

const ADVANCE_MS = 9000;

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
  const [ready, setReady] = useState<Set<string>>(new Set()); // embeds that finished loading
  const [playing, setPlaying] = useState<string | null>(null); // the reel the visitor tapped into
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

  // Tapping into an embed moves focus into its iframe: that's the only signal Instagram gives us.
  useEffect(() => {
    const onBlur = () => setTimeout(() => {
      const f = document.activeElement;
      if (f instanceof HTMLIFrameElement && screen.current?.contains(f)) setPlaying(f.closest<HTMLElement>('[data-key]')?.dataset.key ?? null);
    });
    addEventListener('blur', onBlur);
    return () => removeEventListener('blur', onBlur);
  }, []);
  useEffect(() => setPlaying((p) => (p === activeKey ? p : null)), [activeKey]);

  // Idle feed: advance on a timer unless the visitor is hovering or a reel is playing.
  useEffect(() => {
    if (!autoplay || hover || items.length < 2 || (activeKey && playing === activeKey)) return;
    const t = setTimeout(() => onActive(items[(index + 1) % items.length].key), ADVANCE_MS);
    return () => clearTimeout(t);
  }, [autoplay, hover, items, index, activeKey, playing, onActive]);

  const nextKey = items.length > 1 ? items[(index + 1) % items.length].key : null;
  const step = (d: number) => items.length && onActive(items[(index + d + items.length) % items.length].key);

  return (
    <div className="phone-wrap" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <img className="phone-hand" src={`${import.meta.env.BASE_URL}images/phone-hand.png`} alt="" aria-hidden="true" />
      <div className="phone" aria-label="Reels">
        <div className="phone-status" aria-hidden="true">
          <span>9:41</span>
          <i className="island" />
          <span className="sig">●●● ▮</span>
        </div>
        <div className="phone-top" aria-hidden="true">
          <b>Reels</b>
          {activeKey && ready.has(activeKey) && playing !== activeKey && (
            <span key={activeKey} className="sound-hint">
              <svg viewBox="0 0 24 24" width="13" height="13"><path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor" /><path d="m17 9 5 6m0-6-5 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
              tap the reel for sound
            </span>
          )}
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
            const mounted = isOn || it.key === nextKey; // the reel in view, plus the next one preloaded
            const live = ready.has(it.key);
            return (
              <section key={it.key} className={`slide${isOn ? ' on' : ''}`} data-key={it.key}>
                <div className="slide-media">
                  <div className={`poster${live ? ' gone' : ''}`} aria-hidden={live}>
                    <span className="poster-play" aria-hidden="true">{mounted ? <i className="spin" /> : '▶'}</span>
                    <span className="poster-meta">
                      <b>{it.creator ? `@${it.creator}` : 'Instagram reel'}</b>
                      <small>{ago(it.posted)}{it.badge === 'top' ? ' · Top creator' : it.badge === 'verified' ? ' · Verified' : it.badge === 'local' ? ' · added by you' : it.badge === 'live' ? ' · live result' : ''}</small>
                      {it.caption && <em>{it.caption.slice(0, 120)}</em>}
                    </span>
                  </div>
                  {mounted && (
                    <iframe
                      title={`Reel by @${it.creator}`}
                      src={`https://www.instagram.com/reel/${it.shortcode}/embed/`}
                      allow="autoplay; encrypted-media; picture-in-picture; clipboard-write"
                      className={live ? 'live' : ''}
                      onLoad={() => setReady((s) => (s.has(it.key) ? s : new Set(s).add(it.key)))}
                    />
                  )}
                </div>
                {(it.likes != null || it.comments != null) && (
                  <div className="rail-actions" aria-label="Engagement">
                    {it.likes != null && <span><i>♥</i>{compact(it.likes)}</span>}
                    {it.comments != null && <span><i>💬</i>{compact(it.comments)}</span>}
                    <span><a href={it.url} target="_blank" rel="noreferrer" aria-label="Open on Instagram"><i>↗</i></a></span>
                  </div>
                )}
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
