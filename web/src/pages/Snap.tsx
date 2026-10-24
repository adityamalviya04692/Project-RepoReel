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

  const top = matches?.[0];
  return (
    <section className="tile light page">
      <div className="wrap">
        <p className="eyebrow pill">Vision OCR · runs in your browser</p>
        <h1 className="h-lg">Snap a reel somewhere?<br /><span className="grad">Get the exact repo in seconds.</span></h1>
        <p className="lead">Screenshot the moment the reel shows the repo name, then drop it here or paste it with ⌘V. Text recognition runs on your device; nothing is uploaded.</p>

        <div className="snap-grid">
          <div>
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
              <span className="dz-icon" aria-hidden="true"><span>⤒</span></span>
              <b>{img ? 'Drop another screenshot' : 'Drop a screenshot, or click to choose'}</b>
              <small>Works best when the repo name is large and clear</small>
              <span className="formats"><em>PNG</em><em>JPG</em><em>WEBP</em><em>⌘V paste</em></span>
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
          </div>

          <div className="vision" aria-live="polite">
            <div className="vision-bar"><i /><i /><i /><span>tesseract · on-device</span><b>{ocr ? `${Math.round(ocr.p * 100)}%` : matches ? `${matches.length} detected` : 'idle'}</b></div>
            <div className="vision-shot">{img ? <img src={img} alt="Your screenshot" /> : <p>Your screenshot appears here.<br />Detected repo names are listed below with their match confidence.</p>}</div>
            <div className="detected">
              <h4>Detected strings <span>{matches ? `${matches.length} found` : '—'}</span></h4>
              {matches && matches.length > 0 ? matches.slice(0, 5).map((m) => (
                <div key={m.full} className="det-row">
                  <span>{m.full}</span>
                  <em className={m.confidence >= 0.8 ? 'high' : m.confidence >= 0.55 ? 'mid' : 'low'}>{Math.round(m.confidence * 100)}% · {m.method.replace('_', '/')}</em>
                </div>
              )) : <div className="det-row"><span>{matches ? 'No repository name found' : 'Waiting for a screenshot or text'}</span></div>}
              {top && <a className="btn primary small" href={`https://github.com/${top.full}`} target="_blank" rel="noreferrer">Open {top.full} ↗</a>}
            </div>
          </div>
        </div>

        {matches && (
          <motion.div className="snap-results" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ type: 'spring', bounce: 0, duration: 0.4 }}>
            {matches.length === 0 ? (
              <p className="empty-note">No repository name found in that text. Try a sharper screenshot, or type the name you saw.</p>
            ) : (
              <>
                <h3 className="answers-h">Best match{matches.length > 1 ? 'es' : ''} <small>verified against the catalog</small></h3>
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
