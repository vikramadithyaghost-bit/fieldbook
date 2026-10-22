import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Member, Period, Visit } from '../../shared/domain';
import { ZONES, dLabel, daysFrom, fmtNum, inPeriod, initials, zonePlace, zoneShort } from '../../shared/domain.js';
import { api, ApiError, save, store } from '../lib/api';
import { classRows, groupSchools, schoolsCsv, visitsCsv, type School } from '../lib/schools';
import '../styles/admin.css';

type View = 'overview' | 'schools' | 'members';
const TOKEN_KEY = 'fieldbook-admin-token';
const REFRESH_MS = 30_000;

export default function AdminApp() {
  const [token, setTokenState] = useState<string | null>(() => store(TOKEN_KEY, null));
  const setToken = useCallback((t: string | null) => { save(TOKEN_KEY, t); setTokenState(t); }, []);
  const signOut = useCallback(() => { if (token) api('/logout', { method: 'POST', token }).catch(() => {}); setToken(null); }, [token, setToken]);
  return token ? <Dashboard token={token} signOut={signOut} /> : <Login onToken={setToken} />;
}

function Login({ onToken }: { onToken: (t: string) => void }) {
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    try { onToken((await api<{ token: string }>('/admin/login', { body: { pin } })).token); } catch (e) { setErr((e as Error).message); setPin(''); } finally { setBusy(false); }
  };
  return (
    <div className="a-login">
      <form onSubmit={e => { e.preventDefault(); submit(); }}>
        <div className="logo" style={{ width: 40, height: 40, fontSize: 18 }}>F</div>
        <h1>Fieldbook admin</h1>
        <p>View all school visits and manage team members.</p>
        <label htmlFor="apin">Admin PIN</label>
        <input id="apin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={4} placeholder="4 digits" autoFocus
          value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(''); }} />
        {err && <div className="err-text" style={{ marginTop: 8 }}>{err}</div>}
        <button className="a-btn" style={{ marginTop: 24 }} disabled={busy || pin.length !== 4}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </div>
  );
}

function Dashboard({ token, signOut }: { token: string; signOut: () => void }) {
  const [view, setView] = useState<View>('overview');
  const [visits, setVisits] = useState<Visit[]>([]);
  const [team, setTeam] = useState<Member[]>([]);
  const [loadedAt, setLoadedAt] = useState<Date | null>(null);
  const [loadErr, setLoadErr] = useState('');
  const [period, setPeriod] = useState<Period>('month');
  const [query, setQuery] = useState('');
  const [zoneFilter, setZoneFilter] = useState('');
  const [memberFilter, setMemberFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'done' | 'followup'>('all');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [schoolKey, setSchoolKey] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const call = useCallback(async <T,>(path: string, opts: { method?: string; body?: unknown } = {}) => {
    try { return await api<T>(path, { ...opts, token }); } catch (e) { if (e instanceof ApiError && (e.status === 401 || e.status === 403)) signOut(); throw e; }
  }, [token, signOut]);

  const refresh = useCallback(async () => {
    try {
      const [vs, ms] = await Promise.all([call<Visit[]>('/visits'), call<Member[]>('/members')]);
      setVisits(vs); setTeam(ms); setLoadedAt(new Date()); setLoadErr('');
    } catch (e) { setLoadErr((e as Error).message); }
  }, [call]);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, REFRESH_MS);
    const onFocus = () => refresh();
    window.addEventListener('focus', onFocus);
    return () => { clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [refresh]);

  const schools = useMemo(() => groupSchools(visits), [visits]);
  const q = query.trim().toLowerCase();

  const go = (v: View) => { setView(v); setDetailId(null); setSchoolKey(null); };
  const title = { overview: 'Overview', schools: 'Schools', members: 'Team members' }[view];

  // Overview: KPIs follow every filter; zone and member panels follow the period only.
  const inP = visits.filter(v => inPeriod(v, period));
  const filtered = inP.filter(v => (!zoneFilter || v.zone === zoneFilter) && (!memberFilter || v.by === memberFilter) &&
    (statusFilter === 'all' || v.status === statusFilter) &&
    (!q || [v.school, v.location, v.zone, v.by, v.metName, v.coordName, v.notes].join(' ').toLowerCase().includes(q)));

  const schoolList = useMemo(() => schools.filter(r => (!zoneFilter || r.zone === zoneFilter) && (statusFilter === 'all' || r.status === statusFilter) &&
    (!q || [r.school, r.location, r.zone, r.coordName, r.coordPhone, r.coordEmail, r.members.join(' ')].join(' ').toLowerCase().includes(q))), [schools, zoneFilter, statusFilter, q]);

  const exportCsv = () => view === 'schools' ? schoolsCsv(schoolList) : visitsCsv([...filtered].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)));

  return (
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <div className="logo" style={{ width: 32, height: 32, borderRadius: 9 }}>F</div>
          <div style={{ minWidth: 0 }}><div className="n">Fieldbook</div><div className="d">Kanyakumari district</div></div>
        </div>
        <nav className="nav">
          {([['overview', 'Overview', ''], ['schools', 'Schools', schools.length], ['members', 'Members', team.length]] as const).map(([k, l, c]) => (
            <button key={k} className={view === k ? 'on' : ''} onClick={() => go(k)}><span className="ind" /><span style={{ flex: 1 }}>{l}</span><span className="c">{c}</span></button>
          ))}
        </nav>
        <div className="side-foot">
          <span className="upd"><i className={loadErr ? 'stale' : ''} />{loadErr ? 'Offline' : loadedAt ? 'Updated ' + loadedAt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : 'Loading…'}</span>
          <div className="who"><span style={{ fontWeight: 500 }}>Admin</span><button className="link-btn" style={{ fontSize: 13 }} onClick={signOut}>Sign out</button></div>
        </div>
      </aside>

      <div className="main-col">
        <header className="hdr">
          <h1>{title}</h1>
          {view === 'overview' && (
            <div className="seg">
              {([['today', 'Today'], ['week', '7 days'], ['month', 'Month'], ['all', 'All']] as const).map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}
            </div>
          )}
          {view !== 'members' && <>
            <div className="a-search">
              <span className="search-ico" />
              <input type="search" placeholder={view === 'schools' ? 'Search school, coordinator, phone' : 'Search school, place, person'} value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
            </div>
            <div style={{ marginLeft: 'auto' }}><button className="btn-out" onClick={exportCsv}>Export CSV</button></div>
          </>}
        </header>

        {loadErr && <div style={{ padding: '16px 24px 0' }}><div className="banner-err">Couldn't refresh: {loadErr}. Showing the last loaded data. <button className="link-btn" onClick={refresh}>Retry</button></div></div>}

        {view === 'overview' && (
          <Overview visits={visits} inP={inP} filtered={filtered} period={period} team={team}
            zoneFilter={zoneFilter} setZoneFilter={setZoneFilter} memberFilter={memberFilter} setMemberFilter={setMemberFilter} openVisit={setDetailId} />
        )}
        {view === 'schools' && (
          <Schools all={schools} list={schoolList} zoneFilter={zoneFilter} statusFilter={statusFilter} q={q} page={page} setPage={setPage} selected={schoolKey}
            onZone={z => { setZoneFilter(z); setPage(1); }} onStatus={s => { setStatusFilter(s); setPage(1); }}
            clear={() => { setZoneFilter(''); setMemberFilter(''); setStatusFilter('all'); setQuery(''); setPage(1); }} open={setSchoolKey} />
        )}
        {view === 'members' && <Members team={team} visits={visits} call={call} refresh={refresh} setTeam={setTeam} onRemoved={n => memberFilter === n && setMemberFilter('')} />}
      </div>

      {schoolKey && <SchoolDrawer s={schools.find(r => r.key === schoolKey)} close={() => setSchoolKey(null)} />}
      {detailId && <VisitDrawer v={visits.find(v => v.id === detailId)} close={() => setDetailId(null)} />}
    </div>
  );
}

function Overview({ visits, inP, filtered, period, team, zoneFilter, setZoneFilter, memberFilter, setMemberFilter, openVisit }: {
  visits: Visit[]; inP: Visit[]; filtered: Visit[]; period: Period; team: Member[]; zoneFilter: string; setZoneFilter: (z: string) => void;
  memberFilter: string; setMemberFilter: (m: string) => void; openVisit: (id: string) => void;
}) {
  const schoolCount = new Set(filtered.map(v => v.school.trim().toLowerCase())).size;
  const students = [...new Map(filtered.map(v => [v.school.trim().toLowerCase(), +v.students || 0])).values()].reduce((a, b) => a + b, 0);
  const openFu = visits.filter(v => v.status === 'followup').sort((a, b) => (a.followUp || '').localeCompare(b.followUp || ''));
  const overdue = openFu.filter(v => v.followUp && daysFrom(v.followUp) > 0);
  const periodName = { today: 'today', week: 'last 7 days', month: 'this month', all: 'all time' }[period];

  const zc = ZONES.map(z => ({ z, n: inP.filter(v => v.zone === z).length }));
  const zmax = Math.max(1, ...zc.map(x => x.n));
  const names = [...new Set([...team.map(m => m.name)])];
  const mc = names.map(m => ({ m, n: inP.filter(v => v.by === m).length, fu: openFu.filter(v => v.by === m).length })).sort((a, b) => b.n - a.n || a.m.localeCompare(b.m));
  const mmax = Math.max(1, ...mc.map(x => x.n));

  const kpis = [
    { label: 'Visits', value: filtered.length, sub: periodName },
    { label: 'Schools covered', value: schoolCount, sub: 'unique schools' },
    { label: 'Students reached', value: fmtNum(students), sub: 'across visited schools' },
    { label: 'Open follow-ups', value: openFu.length, sub: 'all time' },
    { label: 'Overdue', value: overdue.length, sub: 'follow-up date passed', color: overdue.length ? 'var(--bad)' : undefined }
  ];

  return (
    <main className="a-main">
      <div className="kpis">
        {kpis.map(k => <div className="kpi" key={k.label}><div className="l">{k.label}</div><div className="v" style={{ color: k.color }}>{k.value}</div><div className="s">{k.sub}</div></div>)}
      </div>
      {(zoneFilter || memberFilter) && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: -4 }}>
          Numbers filtered to {[zoneFilter, memberFilter].filter(Boolean).join(' · ')}. <button className="link-btn" style={{ fontSize: 13 }} onClick={() => { setZoneFilter(''); setMemberFilter(''); }}>Clear</button>
        </div>
      )}
      <div className="panels">
        <section className="panel">
          <div className="panel-h"><h2>Visits by zone</h2><span>click to filter</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {zc.map(({ z, n }) => (
              <button key={z} className={'zrow' + (zoneFilter === z ? ' on' : '')} onClick={() => setZoneFilter(zoneFilter === z ? '' : z)}>
                <span className="ellip" style={{ fontSize: 13 }}><b style={{ fontWeight: 600 }}>{zoneShort(z)}</b> {zonePlace(z)}</span>
                <span className="bar" style={{ height: 8, borderRadius: 4 }}><span style={{ width: (n / zmax * 100) + '%' }} /></span>
                <span className="mono" style={{ fontSize: 13, textAlign: 'right' }}>{n}</span>
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <div className="panel-h"><h2>Team members</h2><span>visits · follow-ups</span></div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {mc.map(({ m, n, fu }) => (
              <button key={m} className={'mrow' + (memberFilter === m ? ' on' : '')} onClick={() => setMemberFilter(memberFilter === m ? '' : m)}>
                <span className="avatar" style={{ width: 26, height: 26, fontSize: 11 }}>{initials(m)}</span>
                <span className="ellip" style={{ fontSize: 13 }}>{m}</span>
                <span className="bar" style={{ height: 6, borderRadius: 3 }}><span style={{ width: (n / mmax * 100) + '%', borderRadius: 0 }} /></span>
                <span className="mono" style={{ fontSize: 13, textAlign: 'right' }}>{n}</span>
                <span className="mono" style={{ fontSize: 13, textAlign: 'right', color: fu ? 'var(--warn)' : 'var(--ink-5)' }}>{fu || '–'}</span>
              </button>
            ))}
            {!mc.length && <div style={{ padding: '20px 0', color: 'var(--ink-3)', fontSize: 13 }}>No team members yet.</div>}
          </div>
        </section>

        <section className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
          <div className="panel-h" style={{ marginBottom: 8 }}><h2>Follow-ups due</h2><span>{openFu.length} open{overdue.length ? ' · ' + overdue.length + ' overdue' : ''}</span></div>
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {openFu.slice(0, 6).map(v => {
              const n = daysFrom(v.followUp);
              return (
                <button key={v.id} className="furow" onClick={() => openVisit(v.id)}>
                  <span style={{ width: 64, flex: 'none', fontSize: 12, fontWeight: 600, color: n > 0 ? 'var(--bad)' : n === 0 ? 'var(--warn)' : 'var(--ink-2)' }}>{n > 0 ? n + 'd overdue' : dLabel(v.followUp)}</span>
                  <span style={{ flex: 1, minWidth: 0 }}>
                    <span className="ellip" style={{ display: 'block', fontSize: 13, fontWeight: 500 }}>{v.school}</span>
                    <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)' }}>{v.by} · {zoneShort(v.zone)}</span>
                  </span>
                </button>
              );
            })}
            {openFu.length > 6 && <div style={{ paddingTop: 8, fontSize: 12, color: 'var(--ink-4)' }}>+ {openFu.length - 6} more on the Schools page</div>}
            {!openFu.length && <div style={{ padding: '20px 0', color: 'var(--ink-3)', fontSize: 13 }}>No open follow-ups.</div>}
          </div>
        </section>
      </div>
    </main>
  );
}

const SCHOOL_COLS: [keyof School | 'last', string, boolean?][] = [
  ['school', 'School'], ['zone', 'Zone'], ['students', 'Students', true], ['coordName', 'Coordinator'], ['coordEmail', 'Email'],
  ['visitCount', 'Visits', true], ['last', 'Last visit'], ['members', 'Visited by'], ['status', 'Status']
];

function Schools({ all, list, zoneFilter, statusFilter, q, page, setPage, selected, onZone, onStatus, clear, open }: {
  all: School[]; list: School[]; zoneFilter: string; statusFilter: string; q: string; page: number; setPage: (p: number) => void; selected: string | null;
  onZone: (z: string) => void; onStatus: (s: 'all' | 'done' | 'followup') => void; clear: () => void; open: (k: string) => void;
}) {
  const [sort, setSort] = useState<string>('last');
  const [dir, setDir] = useState(-1);
  const [pageSize, setPageSize] = useState(10);

  const sval = (r: School): string | number => sort === 'last' ? r.last.date + r.last.time : sort === 'students' ? +r.students || 0 : sort === 'visitCount' ? r.visitCount
    : sort === 'status' ? r.status + (r.followUp || '') : sort === 'members' ? r.membersLabel.toLowerCase() : String(r[sort as keyof School] || '').toLowerCase();
  const sorted = [...list].sort((a, b) => (sval(a) > sval(b) ? 1 : sval(a) < sval(b) ? -1 : 0) * dir);
  const n = sorted.length, pages = Math.max(1, Math.ceil(n / pageSize)), p = Math.min(page, pages), st = (p - 1) * pageSize;
  const rows = sorted.slice(st, st + pageSize);
  const pageBtns = Array.from({ length: pages }, (_, i) => i + 1).filter(i => pages <= 7 || i === 1 || i === pages || Math.abs(i - p) <= 1);

  const kpis = [
    ['Schools', all.length], ['Students', fmtNum(all.reduce((s, r) => s + (+r.students || 0), 0))],
    ['Follow-up open', all.filter(r => r.status === 'followup').length], ['Zones covered', new Set(all.map(r => r.zone).filter(Boolean)).size + ' / ' + ZONES.length]
  ];

  return (
    <main className="a-main">
      <div className="kpis">{kpis.map(([l, v]) => <div className="kpi" key={l}><div className="l">{l}</div><div className="v">{v}</div></div>)}</div>
      <section className="tbl-card">
        <div className="tbl-bar">
          <h2 style={{ margin: '0 auto 0 0', fontSize: 15, fontWeight: 600 }}>All schools <span style={{ fontWeight: 400, color: 'var(--ink-3)', fontSize: 13 }}>· {n} of {all.length}</span></h2>
          <select value={zoneFilter} onChange={e => onZone(e.target.value)} aria-label="Zone"><option value="">All zones</option>{ZONES.map(z => <option key={z} value={z}>{z}</option>)}</select>
          <select value={statusFilter} onChange={e => onStatus(e.target.value as 'all')} aria-label="Status"><option value="all">Any status</option><option value="done">Done</option><option value="followup">Follow-up open</option></select>
          {(zoneFilter || statusFilter !== 'all' || q) && <button className="link-btn" style={{ fontSize: 13, padding: '0 4px' }} onClick={clear}>Clear</button>}
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 1100 }}>
            <thead><tr>
              {SCHOOL_COLS.map(([k, l, right]) => (
                <th key={k} className={'sort' + (right ? ' r' : '')} onClick={() => { if (sort === k) setDir(-dir); else { setSort(k); setDir(['last', 'students', 'visitCount'].includes(k) ? -1 : 1); } setPage(1); }}>
                  {l} <span className="arr">{sort === k ? (dir > 0 ? '↑' : '↓') : ''}</span>
                </th>
              ))}
            </tr></thead>
            <tbody>
              {rows.map(r => {
                const od = r.followUp && daysFrom(r.followUp) > 0;
                return (
                  <tr key={r.key} className={'click' + (selected === r.key ? ' sel' : '')} onClick={() => open(r.key)}>
                    <td style={{ maxWidth: 260 }}><div style={{ fontWeight: 600 }}>{r.school}</div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{r.location}</div></td>
                    <td style={{ whiteSpace: 'nowrap' }}>{zoneShort(r.zone)}</td>
                    <td className="r mono">{r.students ? fmtNum(r.students) : '—'}</td>
                    <td><div>{r.coordName || '—'}</div><div style={{ fontSize: 12, color: 'var(--ink-4)', whiteSpace: 'nowrap' }}>{r.coordPhone}</div></td>
                    <td style={{ color: 'var(--ink-2)' }}>{r.coordEmail || '—'}</td>
                    <td className="r mono">{r.visitCount}</td>
                    <td style={{ whiteSpace: 'nowrap' }}><div>{dLabel(r.last.date)}</div><div style={{ fontSize: 12, color: 'var(--ink-4)' }}>{r.last.by}</div></td>
                    <td>{r.membersLabel}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {r.status === 'done' ? <span className="badge done">Done</span> : <span className={'badge ' + (od ? 'overdue' : 'follow')}>Follow-up {od ? 'overdue' : dLabel(r.followUp)}</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!n && <div style={{ padding: 40, textAlign: 'center', color: 'var(--ink-3)', fontSize: 14 }}>{all.length ? 'No schools match.' : 'No visits logged yet.'}</div>}
        </div>
        <div className="pager">
          <span style={{ fontSize: 13, color: 'var(--ink-3)', marginRight: 'auto' }}>{n ? `Showing ${st + 1}–${Math.min(n, st + pageSize)} of ${n}` : 'No results'}</span>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--ink-3)' }}>Rows
            <select value={pageSize} onChange={e => { setPageSize(+e.target.value); setPage(1); }}>{[5, 10, 25, 50].map(x => <option key={x} value={x}>{x}</option>)}</select>
          </label>
          <div style={{ display: 'flex', gap: 4 }}>
            <button className="nav-b" disabled={p <= 1} onClick={() => setPage(p - 1)}>← Prev</button>
            {pageBtns.map(i => <button key={i} className={'pg' + (i === p ? ' on' : '')} onClick={() => setPage(i)}>{i}</button>)}
            <button className="nav-b" disabled={p >= pages} onClick={() => setPage(p + 1)}>Next →</button>
          </div>
        </div>
      </section>
    </main>
  );
}

function Members({ team, visits, call, refresh, setTeam, onRemoved }: {
  team: Member[]; visits: Visit[]; call: <T>(path: string, opts?: { method?: string; body?: unknown }) => Promise<T>;
  refresh: () => void; setTeam: (t: Member[]) => void; onRemoved: (name: string) => void;
}) {
  const [name, setName] = useState('');
  const [err, setErr] = useState('');
  const [justAdded, setJustAdded] = useState<{ name: string; pin: string; verb: string } | null>(null);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const add = async () => {
    const n = name.trim().replace(/\s+/g, ' ');
    if (!n) return setErr('Enter a name');
    if (team.some(m => m.name.toLowerCase() === n.toLowerCase())) return setErr('A member with this name already exists');
    setBusy(true);
    try {
      const m = await call<Member>('/members', { body: { name: n } });
      setTeam([...team, m]); setName(''); setJustAdded({ name: m.name, pin: m.pin!, verb: 'added' });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const resetPin = async (m: Member) => {
    try {
      const u = await call<Member>('/members/' + m.id + '/reset-pin', { method: 'POST' });
      setTeam(team.map(x => x.id === m.id ? u : x)); setJustAdded({ name: m.name, pin: u.pin!, verb: 'has a new PIN' }); setRevealed(r => ({ ...r, [m.id]: true }));
    } catch (e) { setErr((e as Error).message); refresh(); }
  };
  const remove = async (m: Member) => {
    try { await call('/members/' + m.id, { method: 'DELETE' }); setTeam(team.filter(x => x.id !== m.id)); onRemoved(m.name); } catch (e) { setErr((e as Error).message); refresh(); }
    setConfirmRemove(null);
  };

  return (
    <main className="a-main" style={{ maxWidth: 960, paddingTop: 24 }}>
      <p style={{ margin: 0, fontSize: 14, color: 'var(--ink-3)' }}>Members sign in to the mobile app with their name and 4-digit PIN.</p>
      <section className="panel" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <label htmlFor="newm" style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-2)' }}>Add a member</label>
        <form style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }} onSubmit={e => { e.preventDefault(); add(); }}>
          <input id="newm" value={name} onChange={e => { setName(e.target.value); setErr(''); }} placeholder="Full name" maxLength={100}
            style={{ flex: '1 1 240px', height: 42, border: '1px solid ' + (err ? 'var(--bad)' : 'var(--field)'), borderRadius: 9, padding: '0 12px', fontSize: 15 }} />
          <button className="a-btn" disabled={busy} style={{ flex: 'none', height: 42, padding: '0 18px', borderRadius: 9, fontSize: 14, whiteSpace: 'nowrap' }}>Add &amp; generate PIN</button>
        </form>
        {err && <div className="err-text">{err}</div>}
        {justAdded && (
          <div className="notice">
            <div style={{ flex: '1 1 220px', fontSize: 14, color: '#1F3F7A' }}><b style={{ fontWeight: 600 }}>{justAdded.name}</b> {justAdded.verb}. Share this PIN with them:</div>
            <div className="mono" style={{ fontSize: 26, letterSpacing: '.25em' }}>{justAdded.pin}</div>
            <button className="link-btn" style={{ fontSize: 13 }} onClick={() => setJustAdded(null)}>Done</button>
          </div>
        )}
      </section>
      <section className="tbl-card">
        <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', fontSize: 13, color: 'var(--ink-3)' }}>{team.length} member{team.length === 1 ? '' : 's'}</div>
        <div style={{ overflowX: 'auto' }}>
          <table className="tbl" style={{ minWidth: 640, fontSize: 14 }}>
            <thead><tr><th style={{ paddingLeft: 16 }}>Name</th><th>PIN</th><th className="r">Visits</th><th>Last visit</th><th /></tr></thead>
            <tbody>
              {[...team].sort((a, b) => a.name.localeCompare(b.name)).map(m => {
                const vs = visits.filter(v => v.by === m.name), shown = !!revealed[m.id];
                const last = vs.length ? [...vs].sort((a, b) => b.date.localeCompare(a.date))[0].date : '';
                return (
                  <tr key={m.id}>
                    <td style={{ padding: '10px 16px', verticalAlign: 'middle' }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="avatar" style={{ width: 28, height: 28, fontSize: 11 }}>{initials(m.name)}</span><span style={{ fontWeight: 500 }}>{m.name}</span></div></td>
                    <td style={{ whiteSpace: 'nowrap', verticalAlign: 'middle' }}><div style={{ display: 'flex', alignItems: 'center', gap: 10 }}><span className="mono" style={{ fontSize: 15, letterSpacing: '.15em', width: 56 }}>{shown ? m.pin : '••••'}</span><button className="link-btn" style={{ fontSize: 13 }} onClick={() => setRevealed(r => ({ ...r, [m.id]: !r[m.id] }))}>{shown ? 'Hide' : 'Show'}</button></div></td>
                    <td className="r mono" style={{ verticalAlign: 'middle' }}>{vs.length}</td>
                    <td style={{ color: 'var(--ink-3)', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>{last ? dLabel(last) : '—'}</td>
                    <td style={{ padding: '10px 16px', textAlign: 'right', whiteSpace: 'nowrap', verticalAlign: 'middle' }}>
                      {confirmRemove === m.id ? (
                        <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Remove?</span>
                          <button className="btn-sm solid-red" onClick={() => remove(m)}>Remove</button>
                          <button className="btn-sm" onClick={() => setConfirmRemove(null)}>Cancel</button>
                        </div>
                      ) : (
                        <div style={{ display: 'inline-flex', gap: 6 }}>
                          <button className="btn-sm" onClick={() => resetPin(m)}>Reset PIN</button>
                          <button className="btn-sm red" onClick={() => setConfirmRemove(m.id)}>Remove</button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-4)' }}>Removing a member blocks their sign-in. Their past visits stay in the records. Resetting a PIN signs the member out of the app.</p>
    </main>
  );
}

function Drawer({ zone, title, sub, close, width, children }: { zone: string; title: string; sub: string; close: () => void; width: number; children: ReactNode }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return <>
    <div className="scrim" onClick={close} />
    <aside className="drawer" style={{ width: `min(${width}px, 100%)` }} role="dialog" aria-label={title}>
      <div className="drawer-h">
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 12, color: 'var(--ink-3)', fontWeight: 500 }}>{zone}</div>
          <div className="t">{title}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>{sub}</div>
        </div>
        <button className="x-btn" onClick={close} aria-label="Close">×</button>
      </div>
      <div className="drawer-b">{children}</div>
    </aside>
  </>;
}

function Coordinator({ name, phone, email }: { name: string; phone: string; email: string }) {
  return (
    <div>
      <div className="caps" style={{ marginBottom: 8 }}>School coordinator</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{name || '—'}</div>
      <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 2 }}>
        {phone || email ? <>{phone && <a href={'tel:' + phone.replace(/\s/g, '')}>{phone}</a>}{phone && email && ' · '}{email && <a href={'mailto:' + email}>{email}</a>}</> : 'No contact details'}
      </div>
    </div>
  );
}

function Classes({ title, cc }: { title: string; cc: Record<string, string> | undefined }) {
  const rows = classRows(cc);
  if (!rows.length) return null;
  return (
    <div>
      <div className="caps" style={{ marginBottom: 8 }}>{title}</div>
      <div className="class-grid" style={{ gridTemplateColumns: 'repeat(5,minmax(0,1fr))' }}>{rows.map(r => <div key={r.k}><div className="k">{r.k}</div><div className="v">{r.v}</div></div>)}</div>
    </div>
  );
}

const statusText = (v: { status: string; followUp: string }) => v.status === 'followup' ? 'Follow-up · ' + dLabel(v.followUp, true) : 'Done';

function SchoolDrawer({ s, close }: { s?: School; close: () => void }) {
  if (!s) return null;
  const withClasses = s.visits.find(v => Object.values(v.classCounts || {}).some(x => +x));
  return (
    <Drawer zone={s.zone} title={s.school} sub={s.location} close={close} width={480}>
      <div>
        {[['Students', s.students ? fmtNum(s.students) : '—'], ['Visits', s.visitCount], ['Visited by', s.members.join(', ')], ['Status', statusText(s.last)]].map(([k, v]) => (
          <div className="kv" key={k}><span>{k}</span><span>{v}</span></div>
        ))}
      </div>
      <Coordinator name={s.coordName} phone={s.coordPhone} email={s.coordEmail} />
      <Classes title="Students per class · latest visit" cc={withClasses?.classCounts} />
      <div>
        <div className="caps" style={{ marginBottom: 8 }}>Visit history · {s.visitCount}</div>
        {s.visits.map(h => (
          <div className="hist" key={h.id}>
            <div style={{ fontSize: 12, color: 'var(--ink-3)' }}><div style={{ fontWeight: 600, color: 'var(--ink)' }}>{dLabel(h.date)}</div>{h.time}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 13 }}>
                <b style={{ fontWeight: 600 }}>{h.by}</b><span style={{ color: 'var(--ink-3)' }}>met {h.metName}{h.metRole ? ' (' + h.metRole + ')' : ''}</span>
                {h.status === 'followup' ? <span className="badge follow" style={{ fontSize: 11, padding: '1px 6px', borderRadius: 5 }}>Follow-up {dLabel(h.followUp)}</span>
                  : <span className="badge done" style={{ fontSize: 11, padding: '1px 6px', borderRadius: 5 }}>Done</span>}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-2)', marginTop: 4, whiteSpace: 'pre-wrap' }}>{h.notes || 'No notes.'}</div>
            </div>
          </div>
        ))}
      </div>
    </Drawer>
  );
}

function VisitDrawer({ v, close }: { v?: Visit; close: () => void }) {
  if (!v) return null;
  return (
    <Drawer zone={v.zone} title={v.school} sub={v.location} close={close} width={440}>
      <div>
        {[['Date', dLabel(v.date, true) + (v.time ? ', ' + v.time : '')], ['Visited by', v.by], ['Met with', v.metName + (v.metRole ? ' (' + v.metRole + ')' : '')],
          ['Students', v.students ? fmtNum(v.students) : '—'], ['Status', statusText(v)]].map(([k, val]) => <div className="kv" key={k}><span>{k}</span><span>{val}</span></div>)}
      </div>
      <Coordinator name={v.coordName} phone={v.coordPhone} email={v.coordEmail} />
      <Classes title="Students per class" cc={v.classCounts} />
      <div>
        <div className="caps" style={{ marginBottom: 6 }}>Notes / outcome</div>
        <div style={{ fontSize: 14, lineHeight: 1.55, whiteSpace: 'pre-wrap' }}>{v.notes || 'No notes added.'}</div>
      </div>
    </Drawer>
  );
}
