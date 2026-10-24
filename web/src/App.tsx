import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { load, type Data } from './lib/data';
import Logo from './components/Logo';
import RepoSheet from './components/RepoSheet';
import Home from './pages/Home';
import Snap from './pages/Snap';
import Creators from './pages/Creators';
import PipelinePage from './pages/PipelinePage';
import { ago } from './lib/format';

/* Hash routes keep GitHub Pages happy: #/ (search, ?q=…), #/snap, #/creators, #/pipeline. */
function parse() {
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  return { path: path || '/', q: new URLSearchParams(qs ?? '').get('q') ?? '', repo: new URLSearchParams(qs ?? '').get('repo') ?? '' };
}

const NAV = [
  ['/', 'Discover Reels'],
  ['/snap', 'Snap a Reel'],
  ['/creators', 'Creator Hub'],
  ['/pipeline', 'Trending Pipeline'],
] as const;

export default function App() {
  const [route, setRoute] = useState(parse);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const navSearch = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        navSearch.current?.focus();
      }
    };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, []);
  useEffect(() => {
    const on = () => setRoute(parse());
    addEventListener('hashchange', on);
    load().then(setData, (e) => setError(String(e)));
    return () => removeEventListener('hashchange', on);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0 }); // braces matter: newer browsers return a Promise from scrollTo, which React would call as a cleanup
  }, [route.path]);

  const go = (path: string, params: Record<string, string> = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    location.hash = `#${path}${qs ? `?${qs}` : ''}`;
  };
  const openRepo = (row: number) => data && go(route.path, { q: route.q, repo: data.repos[row].n });
  const sheetRow = data && route.repo ? data.byName.get(route.repo.toLowerCase()) : undefined;

  return (
    <MotionConfig reducedMotion="user">
      <nav className="nav">
        <div className="wrap nav-inner">
          <a className="brand" href="#/" onClick={() => go('/')}><Logo size={26} /><span>RepoReel</span></a>
          <div className="nav-links">
            {NAV.map(([p, label]) => (
              <a key={p} href={`#${p}`} className={route.path === p ? 'on' : ''}><svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{p === '/' ? <><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></> : p === '/snap' ? <><rect x="3" y="5" width="18" height="16" rx="4" /><circle cx="12" cy="13" r="4" /><path d="m8 5 1-3h6l1 3" /></> : p === '/creators' ? <><circle cx="12" cy="8" r="4" /><path d="M4 22v-3a8 8 0 0 1 16 0v3" /></> : <><path d="M4 20V10m8 10V4m8 16v-7" /></>}</svg><span>{label}</span></a>
            ))}
          </div>
          <form className="nav-search" role="search" onSubmit={(e) => { e.preventDefault(); const q = new FormData(e.currentTarget).get('q')?.toString().trim() ?? ''; if (q) go('/', { q }); }}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10.5" cy="10.5" r="7.5" /><path d="m16 16 5 5" /></svg>
            <input ref={navSearch} name="q" key={route.q} defaultValue={route.q} placeholder="Find reel demos with natural language…" aria-label="Search reels" />
            <kbd>⌘K</kbd>
          </form>
          <a className="nav-cta" href="#/snap">Snap Reel</a>
          <a className="nav-gh" href="https://github.com/adityamalviya04692/Project-RepoReel" target="_blank" rel="noreferrer">GitHub</a>
        </div>
      </nav>
      <main>
        {error && <p className="empty-note wrap">Couldn't load the catalog ({error}).</p>}
        {!data && !error && <div className="boot">Loading the catalog…</div>}
        {data && route.path === '/' && <Home data={data} query={route.q} setQuery={(q) => go('/', { q })} onOpen={openRepo} />}
        {data && route.path === '/snap' && <Snap data={data} onOpen={openRepo} />}
        {data && route.path === '/creators' && <Creators data={data} />}
        {data && route.path === '/pipeline' && <PipelinePage data={data} onOpen={openRepo} />}
      </main>
      {data && (
        <footer className="footer">
          <div className="wrap footer-inner">
            <span><span className="sync">Sync: live</span> · {data.repos.length.toLocaleString()} repos indexed · refreshed {ago(data.generated)}</span>
            <span>Uses Instagram's official embeds only · not affiliated with GitHub or Meta · <a href="https://adityamalviya04692.github.io/Portfolio/" target="_blank" rel="noreferrer">Built by Aditya Malviya</a></span>
          </div>
        </footer>
      )}
      <AnimatePresence>
        {data && sheetRow !== undefined && (
          <RepoSheet key="sheet" data={data} row={sheetRow} onClose={() => go(route.path, { q: route.q })} onOpen={(row) => go(route.path, { q: route.q, repo: data.repos[row].n })} />
        )}
      </AnimatePresence>
    </MotionConfig>
  );
}
