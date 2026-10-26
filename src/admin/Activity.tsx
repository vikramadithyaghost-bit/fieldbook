import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Member, Visit } from '../../shared/domain';
import { dLabel, initials, iso, statusLabel, zoneShort } from '../../shared/domain.js';
import { exact } from '../lib/time';

interface Change { field: string; from: string; to: string }
interface Item {
  id: number;
  at: string;
  actor: { role: 'admin' | 'member' | 'unknown'; id: string | null; name: string };
  action: string;
  target: { id: string | null; label: string | null } | null;
  details: Record<string, any>;
}
interface Page { items: Item[]; more: boolean; before: number | null }
type Call = <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;

const TYPES = [['', 'All activity'], ['visits', 'Visits'], ['signins', 'Sign-ins'], ['members', 'Team members'], ['exports', 'Exports']] as const;
const KIND: Record<string, 'visit' | 'member' | 'signin' | 'alert' | 'export'> = {
  'visit.create': 'visit', 'visit.update': 'visit', 'visit.done': 'visit', 'visit.delete': 'alert',
  signin: 'signin', signout: 'signin', 'admin.signin': 'signin', 'signin.failed': 'alert', 'signin.locked': 'alert',
  'admin.signin.failed': 'alert', 'admin.signin.locked': 'alert',
  'member.add': 'member', 'member.readd': 'member', 'member.pin_reset': 'member', 'member.remove': 'alert', 'member.edit_all': 'member',
  export: 'export'
};

const B = ({ children }: { children: ReactNode }) => <b style={{ fontWeight: 600 }}>{children}</b>;

/** One readable sentence per log entry, plus a short line of context underneath. */
function describe(i: Item): { text: ReactNode; sub?: string } {
  const who = <B>{i.actor.name}</B>, t = <B>{i.target?.label || 'a visit'}</B>, d = i.details;
  const visitBits = [d.date && 'visit ' + (/^[A-Z][a-z]+day$/.test(dLabel(d.date)) ? dLabel(d.date).toLowerCase() : dLabel(d.date)), d.zone && zoneShort(d.zone), d.status && statusLabel(d.status) + (d.followUp ? ' ' + dLabel(d.followUp) : ''),
    d.visitedBy && d.visitedBy !== i.actor.name && 'visited by ' + d.visitedBy, d.photos ? d.photos + ' photo' + (d.photos > 1 ? 's' : '') : '', d.located && 'location pinned'];
  switch (i.action) {
    case 'visit.create': return { text: <>{who} added a visit to {t}</>, sub: visitBits.filter(Boolean).join(' · ') };
    case 'visit.update': return { text: <>{who} edited the visit to {t}{d.onBehalf ? <span style={{ color: 'var(--ink-3)' }}> (entered by someone else)</span> : null}</> };
    case 'visit.done': return { text: <>{who} marked the follow-up done for {t}</> };
    case 'visit.delete': return { text: <>{who} deleted the visit to {t}</>, sub: visitBits.filter(Boolean).join(' · ') + (d.notes ? ' · “' + d.notes + '”' : '') };
    case 'signin': return { text: <>{who} signed in on the app</> };
    case 'signout': return { text: <>{who} signed out</> };
    case 'signin.failed': return { text: <>Wrong PIN entered for {who}</> };
    case 'signin.locked': return { text: <>{who} was locked out for 5 minutes after 5 wrong PINs</> };
    case 'admin.signin': return { text: <>{who} signed in to the dashboard</> };
    case 'admin.signin.failed': return { text: <>Wrong admin PIN entered on the dashboard</> };
    case 'admin.signin.locked': return { text: <>Dashboard sign-in locked for 5 minutes after 5 wrong admin PINs</> };
    case 'member.add': return { text: <>{who} added team member {t}</> };
    case 'member.readd': return { text: <>{who} re-added team member {t}</> };
    case 'member.pin_reset': return { text: <>{who} reset {t}'s PIN</>, sub: 'They were signed out on their phone' };
    case 'member.remove': return { text: <>{who} removed team member {t}</> };
    case 'member.edit_all': return { text: d.on ? <>{who} allowed {t} to edit all visits</> : <>{who} stopped {t} from editing all visits</> };
    case 'export': return {
      text: <>{who} exported {d.rows} {d.page === 'schools' ? 'school' : 'visit'}{d.rows === 1 ? '' : 's'} to {d.format === 'csv' ? 'CSV' : 'Excel'}</>,
      sub: d.filters ? 'Filtered: ' + d.filters : d.page === 'schools' ? 'Schools page' : 'Overview page'
    };
    default: return { text: <>{who} · {i.action}</> };
  }
}

const dayLabel = (at: string) => { const d = iso(new Date(at)); return dLabel(d, true); };
const timeLabel = (at: string) => new Date(at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

export function Activity({ call, team, visits, refreshedAt, openVisit, openSchool }: {
  call: Call; team: Member[]; visits: Visit[]; refreshedAt: Date | null; openVisit: (id: string) => void; openSchool: (key: string) => void;
}) {
  const [items, setItems] = useState<Item[]>([]);
  const [more, setMore] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [actor, setActor] = useState('');
  const [type, setType] = useState('');
  const [query, setQuery] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const reqId = useRef(0);

  useEffect(() => { const t = setTimeout(() => setQ(query.trim()), 300); return () => clearTimeout(t); }, [query]);

  const params = useCallback((before?: number | null) => {
    const p = new URLSearchParams({ limit: '50' });
    if (actor) p.set('actor', actor);
    if (type) p.set('type', type);
    if (q) p.set('q', q);
    if (before) p.set('before', String(before));
    return '/activity?' + p;
  }, [actor, type, q]);

  // First page whenever the filters change.
  useEffect(() => {
    const id = ++reqId.current;
    setLoading(true); setErr('');
    call<Page>(params()).then(r => { if (id === reqId.current) { setItems(r.items); setMore(r.more); } })
      .catch(e => id === reqId.current && setErr((e as Error).message)).finally(() => id === reqId.current && setLoading(false));
  }, [call, params]);

  // On each dashboard refresh, add anything new to the top without losing older pages.
  useEffect(() => {
    if (!refreshedAt) return;
    call<Page>(params()).then(r => setItems(cur => {
      const top = cur[0]?.id ?? 0;
      const fresh = r.items.filter(i => i.id > top);
      return fresh.length ? [...fresh, ...cur] : cur;
    })).catch(() => {});
  }, [refreshedAt]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadMore = () => {
    setLoading(true);
    call<Page>(params(items[items.length - 1]?.id)).then(r => { setItems(cur => [...cur, ...r.items]); setMore(r.more); })
      .catch(e => setErr((e as Error).message)).finally(() => setLoading(false));
  };

  const visitIds = useMemo(() => new Set(visits.map(v => v.id)), [visits]);
  const schoolKeys = useMemo(() => new Set(visits.map(v => v.school.trim().toLowerCase())), [visits]);
  const days = useMemo(() => {
    const out: { day: string; items: Item[] }[] = [];
    for (const i of items) {
      const day = dayLabel(i.at);
      if (out[out.length - 1]?.day !== day) out.push({ day, items: [] });
      out[out.length - 1].items.push(i);
    }
    return out;
  }, [items]);
  const filtered = !!(actor || type || q);

  return (
    <main className="a-main" style={{ maxWidth: 1040 }}>
      <section className="tbl-card">
        <div className="tbl-bar">
          <div className="a-search" style={{ flex: '1 1 220px', maxWidth: 'none', margin: '0 auto 0 0' }}>
            <span className="search-ico" />
            <input type="search" placeholder="Search school, person or detail" value={query} onChange={e => setQuery(e.target.value)} />
          </div>
          <select value={actor} onChange={e => setActor(e.target.value)} aria-label="Person">
            <option value="">Everyone</option>
            <option value="admin">Admin</option>
            {[...team].sort((a, b) => a.name.localeCompare(b.name)).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <select value={type} onChange={e => setType(e.target.value)} aria-label="Type">
            {TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
          {filtered && <button className="link-btn" style={{ fontSize: 13, padding: '0 4px' }} onClick={() => { setActor(''); setType(''); setQuery(''); }}>Clear</button>}
        </div>

        {err && <div style={{ padding: '12px 16px' }}><div className="banner-err">Couldn't load activity: {err}</div></div>}

        <div className="act-list">
          {days.map(g => (
            <div key={g.day}>
              <div className="act-day">{g.day}</div>
              {g.items.map(i => {
                const { text, sub } = describe(i), kind = KIND[i.action] || 'visit';
                const changes: Change[] = i.details.changes || [];
                const photoNote = [i.details.photosAdded && `${i.details.photosAdded} photo${i.details.photosAdded > 1 ? 's' : ''} added`,
                  i.details.photosRemoved && `${i.details.photosRemoved} photo${i.details.photosRemoved > 1 ? 's' : ''} removed`].filter(Boolean).join(' · ');
                const tid = i.target?.id, label = i.target?.label?.trim().toLowerCase();
                const link = i.action.startsWith('visit.') && tid && visitIds.has(tid) ? <button className="link-btn" onClick={() => openVisit(tid)}>Open visit</button>
                  : i.action === 'visit.delete' && label && schoolKeys.has(label) ? <button className="link-btn" onClick={() => openSchool(label)}>Open school</button> : null;
                const showChanges = i.action === 'visit.update' && changes.length > 0;
                return (
                  <div className={'act-row ' + kind} key={i.id}>
                    <time className="act-time" dateTime={i.at} title={exact(i.at)}>{timeLabel(i.at)}</time>
                    <div className={'avatar' + (i.actor.role === 'admin' ? ' admin' : '')} style={{ width: 28, height: 28, fontSize: 11 }}>{i.actor.role === 'admin' ? 'A' : initials(i.actor.name) || '?'}</div>
                    <div style={{ minWidth: 0 }}>
                      <div className="act-text">{text}</div>
                      {(sub || photoNote) && <div className="act-sub">{[sub, photoNote].filter(Boolean).join(' · ')}</div>}
                      {showChanges && (open[i.id] || changes.length <= 3 ? (
                        <ul className="act-changes">
                          {changes.map((c, k) => (
                            <li key={k}><span className="f">{c.field}</span> <span className="from">{c.from || 'empty'}</span> <span className="arrow">→</span> <span className="to">{c.to || 'empty'}</span></li>
                          ))}
                        </ul>
                      ) : <button className="link-btn act-more" onClick={() => setOpen(o => ({ ...o, [i.id]: true }))}>Show {changes.length} changes</button>)}
                      {link && <div style={{ marginTop: 4, fontSize: 13 }}>{link}</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
          {!items.length && !loading && !err && <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>{filtered ? 'Nothing matches these filters.' : 'No activity yet.'}</div>}
          {loading && !items.length && <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>Loading…</div>}
        </div>
        {more && <div className="pager" style={{ justifyContent: 'center' }}><button className="nav-b" onClick={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load older activity'}</button></div>}
      </section>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-4)' }}>Everything people do in the app and dashboard is recorded here: visits added, edited and deleted (with what changed), sign-ins and wrong PINs, team changes and exports. PINs are never recorded. Times are when the change reached the server, so a visit saved offline appears when it synced.</p>
    </main>
  );
}
