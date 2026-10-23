import { useEffect, useState } from 'react';
import { AnimatePresence, MotionConfig } from 'motion/react';
import { load, type Data } from './lib/data';
import Logo from './components/Logo';
import RepoSheet from './components/RepoSheet';
import Home from './pages/Home';
import Snap from './pages/Snap';
import Creators from './pages/Creators';
import PipelinePage from './pages/PipelinePage';
import { ago, compact } from './lib/format';

/* Hash routes keep GitHub Pages happy: #/ (search, ?q=…), #/snap, #/creators, #/pipeline. */
function parse() {
  const [path, qs] = location.hash.replace(/^#/, '').split('?');
  return { path: path || '/', q: new URLSearchParams(qs ?? '').get('q') ?? '', repo: new URLSearchParams(qs ?? '').get('repo') ?? '' };
}

const NAV = [
  ['/', 'Search'],
  ['/snap', 'Snap a reel'],
  ['/creators', 'Creators'],
  ['/pipeline', 'Pipeline'],
] as const;

export default function App() {
  const [route, setRoute] = useState(parse);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const on = () => setRoute(parse());
    addEventListener('hashchange', on);
    load().then(setData, (e) => setError(String(e)));
    return () => removeEventListener('hashchange', on);
  }, []);
  useEffect(() => window.scrollTo({ top: 0 }), [route.path]);

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
              <a key={p} href={`#${p}`} className={route.path === p ? 'on' : ''}>{label}</a>
            ))}
          </div>
          <a className="nav-gh" href="https://github.com/adityamalviya04692/Project-RepoReel" target="_blank" rel="noreferrer">GitHub ↗</a>
        </div>
      </nav>
      <main>
        {error && <p className="empty-note wrap">Couldn't load the catalog ({error}).</p>}
        {!data && !error && <div className="boot">Loading the catalog…</div>}
        {data && route.path === '/' && <Home data={data} query={route.q} setQuery={(q) => go('/', { q })} onOpen={openRepo} />}
        {data && route.path === '/snap' && <Snap data={data} onOpen={openRepo} />}
        {data && route.path === '/creators' && <Creators data={data} />}
        {data && route.path === '/pipeline' && <PipelinePage data={data} />}
      </main>
      {data && (
        <footer className="footer">
          <div className="wrap footer-inner">
            <span>RepoReel · {compact(data.repos.length)} repositories · data refreshed {ago(data.generated)}</span>
            <span>Uses Instagram's official embeds only · not affiliated with GitHub, Meta or Apple · <a href="https://adityamalviya04692.github.io/Portfolio/" target="_blank" rel="noreferrer">Built by Aditya Malviya</a></span>
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
