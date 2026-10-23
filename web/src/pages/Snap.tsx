import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { Data } from '../lib/data';
import { resolve, type Match } from '../lib/match';
import { readText } from '../lib/ocr';
import { compact } from '../lib/format';
import RepoCard from '../components/RepoCard';

/* Snap a reel: screenshot → OCR in the browser → candidate names → exact repository. */
export default function Snap({ data, onOpen }: { data: Data; onOpen: (row: number) => void }) {
  const [img, setImg] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [ocr, setOcr] = useState<{ p: number; status: string } | null>(null);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [over, setOver] = useState(false);
  const cat = useMemo(() => ({ names: data.repos.map((r) => r.n), stars: data.repos.map((r) => r.s), byFull: data.byName }), [data]);

  async function take(file: File | Blob) {
    setImg(URL.createObjectURL(file));
    setMatches(null);
    setOcr({ p: 0, status: 'loading OCR' });
    try {
      const t = await readText(file, (p, status) => setOcr({ p, status }));
      setText(t.trim());
      setOcr(null);
      void find(t);
    } catch {
      setOcr(null);
      setText('');
    }
  }

  async function find(t: string) {
    setMatches(await resolve(t, cat));
  }

  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const f = [...(e.clipboardData?.files ?? [])].find((x) => x.type.startsWith('image/'));
      if (f) void take(f);
    };
    addEventListener('paste', onPaste);
    return () => removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="tile parchment page">
      <div className="wrap narrow">
        <p className="eyebrow">Snap a reel</p>
        <h1 className="h-lg">Which repo was that?</h1>
        <p className="lead muted">Screenshot the moment the reel shows the repo name, then drop it here or paste it with ⌘V. Text recognition runs on your device; nothing is uploaded.</p>

        <label
          className={`dropzone${over ? ' over' : ''}`}
          onDragOver={(e) => (e.preventDefault(), setOver(true))}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setOver(false);
            const f = e.dataTransfer.files[0];
            if (f) void take(f);
          }}
        >
          <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && take(e.target.files[0])} />
          {img ? <img src={img} alt="Your screenshot" /> : <span className="dz-icon" aria-hidden="true">⤒</span>}
          <b>{img ? 'Drop another screenshot' : 'Drop a screenshot, or click to choose'}</b>
          <small>PNG or JPG · works best when the repo name is large and clear</small>
          {ocr && (
            <span className="ocr-bar" aria-live="polite">
              <i style={{ width: `${ocr.p * 100}%` }} />
              <em>{ocr.status} {Math.round(ocr.p * 100)}%</em>
            </span>
          )}
        </label>

        <div className="or">or paste the caption or the text you saw</div>
        <form className="text-find" onSubmit={(e) => (e.preventDefault(), find(text))}>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="e.g. “This open-source repo browser-use lets AI control your browser 🤯”" aria-label="Caption or recognised text" />
          <button className="btn primary" disabled={!text.trim()}>Find the repo</button>
        </form>

        {matches && (
          <motion.div className="snap-results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.4 }}>
            {matches.length === 0 ? (
              <p className="empty-note">No repository name found in that text. Try a sharper screenshot, or type the name you saw.</p>
            ) : (
              <>
                <h3 className="h-md">Best match{matches.length > 1 ? 'es' : ''}</h3>
                {matches.slice(0, 4).map((m, k) => {
                  const row = data.byName.get(m.full.toLowerCase());
                  return (
                    <div key={m.full} className="snap-match">
                      <span className={`confidence ${m.confidence >= 0.8 ? 'high' : m.confidence >= 0.55 ? 'mid' : 'low'}`}>
                        {Math.round(m.confidence * 100)}% · {m.method.replace('_', '/')}
                      </span>
                      {row !== undefined ? (
                        <RepoCard r={data.repos[row]} data={data} index={k} onOpen={() => onOpen(row)} />
                      ) : (
                        <a className="repo-card outside" href={`https://github.com/${m.full}`} target="_blank" rel="noreferrer">
                          <b>{m.full}</b>
                          <span>{m.description}</span>
                          <small>★ {compact(m.stars ?? 0)} · not in our catalog yet · open on GitHub ↗</small>
                        </a>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </motion.div>
        )}
      </div>
    </section>
  );
}
