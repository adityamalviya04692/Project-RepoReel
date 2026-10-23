import type { Repo } from '../lib/data';
import { ago, compact } from '../lib/format';
import { aiLabel } from '../lib/rank';

/* One quiet row of facts: stars and momentum, last push, licence, language, AI-tool fit. */
export default function HealthStrip({ r, dark = false }: { r: Repo; dark?: boolean }) {
  const pushedDays = (Date.now() - Date.parse(r.p)) / 864e5;
  const push = r.a ? 'bad' : pushedDays <= 30 ? 'good' : pushedDays <= 180 ? 'warn' : 'bad';
  return (
    <ul className={`health${dark ? ' on-dark' : ''}`} aria-label="Repository health">
      <li title={`${r.s.toLocaleString()} stars`}>★ {compact(r.s)}</li>
      {r.mo.d7 != null && r.mo.d7 > 0 && (
        <li className="up" title={r.mo.est ? 'estimated from age (new repo)' : 'from daily snapshots'}>
          +{compact(r.mo.d7)} this week{r.mo.est ? '*' : ''}
        </li>
      )}
      <li className={push}>{r.a ? 'archived' : `pushed ${ago(r.p)}`}</li>
      {r.lic && r.lic !== 'NOASSERTION' ? <li>{r.lic}</li> : <li className="warn">no licence</li>}
      {r.l && <li>{r.l}</li>}
      {r.ai.slice(0, 3).map((a) => (
        <li key={a} className="ai">{aiLabel(a)}</li>
      ))}
    </ul>
  );
}
