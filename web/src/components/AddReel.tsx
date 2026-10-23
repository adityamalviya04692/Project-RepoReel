import { useEffect, useRef, useState } from 'react';
import type { Data } from '../lib/data';
import { loadLocal, normalizeReelUrl, resolveRepo, saveLocal, type LocalReel } from '../lib/reels';
import { embedQuery } from '../lib/embedder';
import { BM25, rank, searchText, tokens } from '../lib/rank';
import { compact } from '../lib/format';

/* Add a reel you've seen. It's indexed in this browser immediately (embedded with the same model
   as the pipeline), and can be exported as curated/reels.yaml entries for everyone. */
export default function AddReel({ data, open, onClose, onChange }: { data: Data; open: boolean; onClose: () => void; onChange: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [url, setUrl] = useState('');
  const [creator, setCreator] = useState('');
  const [repo, setRepo] = useState('');
  const [caption, setCaption] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<LocalReel[]>(loadLocal);
  const [copied, setCopied] = useState(false);
  const [suggest, setSuggest] = useState<{ url: string; rows: number[] } | null>(null);

  // No repo name in the description: offer the most likely repos instead of guessing silently.
  async function suggestFor(u: string, text: string) {
    const bm = new BM25(data.repos.map((r) => tokens(searchText(r))));
    let v: Float32Array | null = null;
    try {
      v = await embedQuery(text);
    } catch {
      v = null;
    }
    setSuggest({ url: u, rows: rank(text, v, data, bm, 3).results.map((x) => x.i) });
  }

  function assign(u: string, full: string) {
    const next = list.map((x) => (x.url === u ? { ...x, repo: full } : x));
    saveLocal(next);
    setList(next);
    setSuggest(null);
    onChange();
  }

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      setList(loadLocal());
      d.showModal();
    }
    if (!open && d.open) d.close();
  }, [open]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const u = normalizeReelUrl(url);
    if (!u) return setError('Paste an Instagram reel link, like https://www.instagram.com/reel/ABC123/');
    if (!repo.trim() && !caption.trim()) return setError('Add the repo (owner/name or GitHub link) or describe what the reel shows.');
    setBusy(true);
    const full = await resolveRepo(data, repo, caption);
    setBusy(false);
    if (!full && !caption.trim()) return setError("Couldn't recognise that repo. Use owner/name, like browser-use/browser-use.");
    const next = [{ url: u, creator: creator.trim().replace(/^@/, '').toLowerCase() || 'unknown', repo: full, caption: caption.trim(), posted: new Date().toISOString().slice(0, 10), added: new Date().toISOString() }, ...list.filter((x) => x.url !== u)];
    saveLocal(next);
    setList(next);
    setUrl('');
    setRepo('');
    setError('');
    onChange();
    if (!full) void suggestFor(u, caption);
    setCaption('');
  }

  function remove(u: string) {
    const next = list.filter((x) => x.url !== u);
    saveLocal(next);
    setList(next);
    onChange();
  }

  const yaml = list
    .map((r) => [`  - url: ${r.url}`, `    creator: ${r.creator}`, `    posted: ${r.posted}`, r.repo ? `    repo: ${r.repo}` : '', r.caption ? `    caption: ${JSON.stringify(r.caption)}` : ''].filter(Boolean).join('\n'))
    .join('\n');

  return (
    <dialog ref={ref} className="dialog" onClose={onClose} onCancel={onClose} aria-labelledby="add-title">
      <form onSubmit={save}>
        <h2 id="add-title">Add a reel</h2>
        <p className="muted small">Saw a reel about a GitHub repo? Add it and it shows up in the phone and in search. Stored only in this browser; export it to share.</p>
        <label>Reel link<input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.instagram.com/reel/…" required /></label>
        <div className="row2">
          <label>Creator<input value={creator} onChange={(e) => setCreator(e.target.value)} placeholder="@handle" /></label>
          <label>Repo<input value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/name or GitHub link" /></label>
        </div>
        <label>What the reel shows<textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={3} placeholder="Paste the caption, or describe it: “AI agent that applies to LinkedIn jobs for you”" /></label>
        {error && <p className="form-error">{error}</p>}
        {suggest && (
          <div className="suggest">
            <b>Which repo does this reel show?</b>
            {suggest.rows.map((i) => (
              <button type="button" key={i} onClick={() => assign(suggest.url, data.repos[i].n)}>
                <span>{data.repos[i].n}</span>
                <small>★ {compact(data.repos[i].s)} · {data.repos[i].d.slice(0, 70)}</small>
              </button>
            ))}
            <button type="button" className="link" onClick={() => setSuggest(null)}>None of these</button>
          </div>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn secondary" onClick={onClose}>Done</button>
          <button className="btn primary" disabled={busy}>{busy ? 'Finding repo…' : 'Add reel'}</button>
        </div>
      </form>
      {list.length > 0 && (
        <div className="local-list">
          <div className="ll-head">
            <b>Your reels · {list.length}</b>
            <button className="link" onClick={() => void navigator.clipboard?.writeText(yaml).then(() => (setCopied(true), setTimeout(() => setCopied(false), 1500)))}>
              {copied ? 'Copied' : 'Copy as reels.yaml'}
            </button>
          </div>
          {list.map((r) => (
            <div key={r.url} className="ll-row">
              <span><b>{r.repo ?? 'repo not identified'}</b><small>{r.url}</small></span>
              <button className="link" onClick={() => remove(r.url)}>Remove</button>
            </div>
          ))}
        </div>
      )}
    </dialog>
  );
}
