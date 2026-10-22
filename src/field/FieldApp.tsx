import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { Period, Visit } from '../../shared/domain';
import { CLASSES, ZONES, ago, classLabel, dLabel, fmtNum, inPeriod, initials, iso, validateVisit, zoneShort } from '../../shared/domain.js';
import { classRows } from '../lib/schools';
import { useFieldStore } from './useFieldStore';
import '../styles/field.css';

type Screen = { name: 'home' } | { name: 'form' } | { name: 'detail'; id: string };
type Draft = Partial<Visit> & { classCounts?: Record<string, string> };

export default function FieldApp() {
  const [toast, setToast] = useState('');
  const timer = useRef<number>();
  const flash = useCallback((msg: string) => {
    clearTimeout(timer.current);
    setToast(msg);
    timer.current = window.setTimeout(() => setToast(''), 2200);
  }, []);
  const fs = useFieldStore(flash);
  const [screen, setScreenState] = useState<Screen>({ name: 'home' });

  useEffect(() => { document.body.classList.add('field'); return () => document.body.classList.remove('field'); }, []);

  // The phone's back button returns to the visit list from the form or a visit.
  const setScreen = (s: Screen) => {
    if (s.name !== 'home' && screen.name === 'home') history.pushState({ fb: s.name }, '');
    if (s.name === 'home' && screen.name !== 'home' && history.state?.fb) { history.back(); return; }
    setScreenState(s);
  };
  useEffect(() => {
    const onPop = () => setScreenState({ name: 'home' });
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="app">
      {!fs.auth ? <Login fs={fs} /> :
        screen.name === 'form' ? <VisitForm fs={fs} close={() => setScreen({ name: 'home' })} flash={flash} /> :
        screen.name === 'detail' ? <Detail fs={fs} id={screen.id} back={() => setScreen({ name: 'home' })} flash={flash} /> :
        <Home fs={fs} open={id => setScreen({ name: 'detail', id })} newVisit={() => setScreen({ name: 'form' })} />}
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

type FS = ReturnType<typeof useFieldStore>;

function Login({ fs }: { fs: FS }) {
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!name) return setErr('Select your name');
    if (pin.length !== 4) return setErr('Enter your 4-digit PIN');
    setBusy(true);
    try { await fs.signIn(name, pin); } catch (e) { setErr((e as Error).message); setPin(''); } finally { setBusy(false); }
  };
  return (
    <form className="login" onSubmit={e => { e.preventDefault(); submit(); }}>
      <div className="logo" style={{ width: 44, height: 44, borderRadius: 12, fontSize: 20 }}>F</div>
      <h1>Fieldbook</h1>
      <p>Log school visits from the field. Everyone on the team sees every visit.</p>
      <label className="f-label" htmlFor="who" style={{ marginBottom: 6 }}>Who are you?</label>
      <select id="who" className="f-input" value={name} onChange={e => { setName(e.target.value); setErr(''); }}>
        <option value="">Select your name</option>
        {fs.team.map(m => <option key={m.id} value={m.name}>{m.name}</option>)}
      </select>
      <label className="f-label" htmlFor="pin" style={{ marginBottom: 6 }}>Your PIN</label>
      <input id="pin" className="f-input pin" type="password" inputMode="numeric" autoComplete="current-password" maxLength={4} placeholder="4 digits"
        value={pin} onChange={e => { setPin(e.target.value.replace(/\D/g, '').slice(0, 4)); setErr(''); }} />
      {err && <div className="err-text" style={{ marginTop: 8 }}>{err}</div>}
      {!fs.team.length && !fs.online && <div className="err-text" style={{ marginTop: 8 }}>Can't reach the server. Connect to the internet to sign in. <button type="button" className="link-btn" onClick={fs.loadTeam}>Retry</button></div>}
      <div className="f-hint" style={{ marginTop: 8 }}>Your admin shares your PIN.</div>
      <div style={{ flex: 1, minHeight: 24 }} />
      <button className="btn-primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
  );
}

function SyncPill({ fs }: { fs: FS }) {
  const label = !fs.online ? 'Offline' + (fs.pending ? ' · ' + fs.pending + ' queued' : '') : fs.syncing ? (fs.pending ? 'Syncing ' + fs.pending : 'Syncing') : fs.pending ? fs.pending + ' to sync' : 'Synced';
  return (
    <button className={'sync ' + (fs.online ? 'on' : 'off')} onClick={fs.sync} title="Sync now">
      {fs.syncing ? <span className="spin" /> : <span className="dot" />}{label}
    </button>
  );
}

function Badges({ v }: { v: Visit }) {
  return <>
    {v.status === 'done' && <span className="badge done">Done</span>}
    {v.status === 'followup' && <span className="badge follow">Follow-up {dLabel(v.followUp)}</span>}
    {v.pending && <span className="badge pending">Not synced</span>}
  </>;
}

function Home({ fs, open, newVisit }: { fs: FS; open: (id: string) => void; newVisit: () => void }) {
  const [tab, setTab] = useState<'visits' | 'team'>('visits');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<'all' | 'done' | 'followup'>('all');
  const [member, setMember] = useState('');
  const [zone, setZone] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [period, setPeriod] = useState<Period>('month');

  const visits = fs.visits, q = query.trim().toLowerCase();
  const filtered = visits.filter(v => (status === 'all' || v.status === status) && (!member || v.by === member) && (!zone || v.zone === zone) &&
    (!q || [v.school, v.location, v.zone, v.by, v.metName, v.coordName].join(' ').toLowerCase().includes(q)));
  const followups = visits.filter(v => v.status === 'followup');
  const active = (status !== 'all' ? 1 : 0) + (member ? 1 : 0) + (zone ? 1 : 0);
  const names = [...new Set([...fs.team.map(m => m.name)])];

  const stats = names.map(name => {
    const mine = visits.filter(v => v.by === name);
    return { name, count: mine.filter(v => inPeriod(v, period)).length, last: mine[0], fu: mine.filter(v => v.status === 'followup').length };
  }).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const max = Math.max(1, ...stats.map(x => x.count));
  const total = stats.reduce((n, x) => n + x.count, 0);

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <header className="top">
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1>{tab === 'visits' ? 'Team visits' : 'Team'}</h1>
          <div className="sub">{new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}</div>
        </div>
        <SyncPill fs={fs} />
      </header>

      <div className="scroll">
        {tab === 'visits' ? (
          <div className="page">
            <div className="counts">
              {([['Today', 'today'], ['This week', 'week'], ['This month', 'month']] as const).map(([l, p]) => (
                <div className="card count" key={p}><div className="l">{l}</div><div className="v">{visits.filter(v => inPeriod(v, p)).length}</div></div>
              ))}
            </div>
            {followups.length > 0 && (
              <button className="fu-banner" onClick={() => { setStatus('followup'); setFiltersOpen(true); setQuery(''); }}>
                <span>{followups.length} school{followups.length > 1 ? 's' : ''} need{followups.length > 1 ? '' : 's'} a follow-up</span><span style={{ fontWeight: 600 }}>View →</span>
              </button>
            )}
            <div className="searchrow">
              <div className="searchbox"><span className="search-ico" style={{ width: 12, height: 12 }} /><input placeholder="Search school, place, person" value={query} onChange={e => setQuery(e.target.value)} type="search" /></div>
              <button className={'filter-btn' + (active ? ' active' : '')} onClick={() => setFiltersOpen(!filtersOpen)}>{active ? 'Filters · ' + active : 'Filters'}</button>
            </div>
            {filtersOpen && (
              <div className="card filters">
                <div className="caps">Status</div>
                <div className="chips">
                  {([['all', 'All'], ['done', 'Done'], ['followup', 'Follow-up']] as const).map(([k, l]) => <button key={k} className={status === k ? 'on' : ''} onClick={() => setStatus(k)}>{l}</button>)}
                </div>
                <div className="caps">Visited by</div>
                <select className="f-input" value={member} onChange={e => setMember(e.target.value)}>
                  <option value="">Anyone</option>
                  {names.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <div className="caps">Zone</div>
                <select className="f-input" value={zone} onChange={e => setZone(e.target.value)}>
                  <option value="">All zones</option>
                  {ZONES.map(z => <option key={z} value={z}>{z}</option>)}
                </select>
                {active > 0 && <button className="link-btn" style={{ alignSelf: 'flex-start', fontSize: 14 }} onClick={() => { setStatus('all'); setMember(''); setZone(''); }}>Clear filters</button>}
              </div>
            )}
            <div className="sec-head"><div>Recent visits</div><div>{filtered.length} of {visits.length}</div></div>
            <div className="card list">
              {filtered.map(v => (
                <button className="row" key={v.id} onClick={() => open(v.id)}>
                  <div className="avatar" style={{ width: 36, height: 36, fontSize: 13 }}>{initials(v.by)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}><div className="t">{v.school}</div><div style={{ fontSize: 12, color: 'var(--ink-3)', flex: 'none' }}>{dLabel(v.date)}</div></div>
                    <div className="s">{(v.zone ? zoneShort(v.zone) + ' · ' : '') + v.location + ' · ' + v.by.split(' ')[0]}</div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 8 }}><Badges v={v} /></div>
                  </div>
                </button>
              ))}
              {!filtered.length && <div className="empty">{visits.length ? 'No visits match.' : 'No visits yet. Tap New visit to log one.'}</div>}
            </div>
          </div>
        ) : (
          <div className="page">
            <div className="seg lg">
              {([['today', 'Today'], ['week', 'Week'], ['month', 'Month']] as const).map(([k, l]) => <button key={k} className={period === k ? 'on' : ''} onClick={() => setPeriod(k)}>{l}</button>)}
            </div>
            <div className="sec-head" style={{ paddingTop: 0 }}><div>Visits by member</div><div>{total} visit{total === 1 ? '' : 's'} total</div></div>
            <div className="card list">
              {stats.map(x => (
                <button className="row" key={x.name} style={{ alignItems: 'center', padding: '12px 14px' }} onClick={() => { setTab('visits'); setMember(x.name); setFiltersOpen(true); }}>
                  <div className="avatar" style={{ width: 32, height: 32, fontSize: 12 }}>{initials(x.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><span style={{ fontSize: 14, fontWeight: 500 }}>{x.name}</span><span className="mono" style={{ fontSize: 14 }}>{x.count}</span></div>
                    <span className="bar" style={{ height: 6, borderRadius: 3, marginTop: 6 }}><span style={{ width: (x.count / max * 100) + '%' }} /></span>
                    <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>
                      {(x.last ? 'Last visit ' + dLabel(x.last.date).toLowerCase() : 'No visits yet') + (x.fu ? ' · ' + x.fu + ' open follow-up' + (x.fu > 1 ? 's' : '') : '')}
                    </div>
                  </div>
                </button>
              ))}
            </div>
            <div className="card" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px' }}>
              <div><div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Signed in as</div><div style={{ fontSize: 15, fontWeight: 600 }}>{fs.auth!.user.name}</div></div>
              <button style={{ border: '1px solid var(--field)', background: '#fff', borderRadius: 8, height: 34, padding: '0 12px', fontSize: 14, fontWeight: 500 }}
                onClick={() => { if (!fs.pending || confirm(fs.pending + " change(s) haven't synced yet. They'll upload the next time someone signs in on this phone. Sign out?")) fs.signOut(); }}>Sign out</button>
            </div>
          </div>
        )}
      </div>

      <button className="fab" onClick={newVisit}><b>+</b>New visit</button>
      <nav className="tabbar">
        {([['visits', 'Visits'], ['team', 'Team']] as const).map(([k, l]) => <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}><span />{l}</button>)}
      </nav>
    </div>
  );
}

const STEPS = ['School', 'Visit', 'People', 'Outcome'];

function VisitForm({ fs, close, flash }: { fs: FS; close: () => void; flash: (m: string) => void }) {
  const user = fs.auth!.user.name;
  const [step, setStep] = useState(0);
  const [d, setD] = useState<Draft>(() => ({ date: iso(new Date()), time: new Date().toTimeString().slice(0, 5), by: user, status: 'done', classCounts: {} }));
  const [err, setErr] = useState<Record<string, string>>({});
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => { scroller.current?.scrollTo(0, 0); }, [step]);

  const set = (k: keyof Visit) => (e: { target: { value: string } }) => { const val = e.target.value; setD(x => ({ ...x, [k]: val })); setErr(x => ({ ...x, [k]: '' })); };
  const cc = d.classCounts || {};
  const classTotal = CLASSES.reduce((n, c) => n + (parseInt(cc[c], 10) || 0), 0);
  const names = fs.team.map(m => m.name).includes(user) ? fs.team.map(m => m.name) : [user, ...fs.team.map(m => m.name)];
  const field = (k: keyof Visit) => 'f-input' + (err[k] ? ' bad' : '');
  const E = ({ k }: { k: string }) => err[k] ? <div className="err-text">{err[k]}</div> : null;

  const next = () => {
    const e = validateVisit(d, step);
    if (Object.keys(e).length) return setErr(e);
    if (step < 3) return setStep(step + 1);
    const v = { ...d, id: 'v-' + crypto.randomUUID(), students: classTotal ? String(classTotal) : '', followUp: d.status === 'followup' ? d.followUp : '' } as Visit;
    fs.addVisit(v);
    flash(fs.online ? 'Visit saved' : 'Saved offline · will sync later');
    close();
  };

  return (
    <div className="form">
      <div className="form-head">
        <div className="nav">
          <button className="link-btn" style={{ fontSize: 16, fontWeight: 400 }} onClick={() => { if (!d.school || confirm('Discard this visit?')) close(); }}>Cancel</button>
          <div style={{ fontSize: 16, fontWeight: 600 }}>New visit</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', width: 52, textAlign: 'right' }}>{step + 1} of 4</div>
        </div>
        <div className="steps">{STEPS.map((_, i) => <div key={i} className={i <= step ? 'on' : ''} />)}</div>
        <div style={{ fontSize: 20, fontWeight: 600, marginTop: 14 }}>{STEPS[step]}</div>
      </div>

      <div className="form-body" ref={scroller}>
        {step === 0 && <>
          <div className="f-field"><label className="f-label">School name *</label><input className={field('school')} value={d.school || ''} onChange={set('school')} placeholder="e.g. Govt. Higher Secondary School" /><E k="school" /></div>
          <div className="f-field"><label className="f-label">Location *</label><input className={field('location')} value={d.location || ''} onChange={set('location')} placeholder="Area, town / district" /><E k="location" /></div>
          <div className="f-field">
            <label className="f-label">Zone *</label>
            <select className={field('zone')} value={d.zone || ''} onChange={set('zone')}><option value="">Select zone</option>{ZONES.map(z => <option key={z} value={z}>{z}</option>)}</select>
            <E k="zone" />
          </div>
          <div className="f-field" style={{ gap: 8 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <label className="f-label">Students per class</label>
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Total <span className="mono" style={{ color: 'var(--ink)' }}>{fmtNum(classTotal)}</span></span>
            </div>
            <div className="class-inputs">
              {CLASSES.map(c => (
                <div key={c} style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                  <span style={{ fontSize: 11, color: 'var(--ink-3)', fontWeight: 500 }}>{classLabel(c)}</span>
                  <input inputMode="numeric" placeholder="0" value={cc[c] || ''} aria-label={'Students in ' + classLabel(c)}
                    onChange={e => { const val = e.target.value.replace(/\D/g, '').slice(0, 4); setD(x => ({ ...x, classCounts: { ...(x.classCounts || {}), [c]: val } })); }} />
                </div>
              ))}
            </div>
            <div className="f-hint">Leave blank for classes the school doesn't have.</div>
          </div>
        </>}

        {step === 1 && <>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(0,1fr)', gap: 10 }}>
            <div className="f-field"><label className="f-label">Date *</label><input type="date" className={field('date')} style={{ fontSize: 15, padding: '0 10px' }} value={d.date || ''} onChange={set('date')} /><E k="date" /></div>
            <div className="f-field"><label className="f-label">Time</label><input type="time" className="f-input" style={{ fontSize: 15, padding: '0 10px' }} value={d.time || ''} onChange={set('time')} /></div>
          </div>
          <div className="f-field">
            <label className="f-label">Visited by *</label>
            <select className={field('by')} value={d.by || ''} onChange={set('by')}>{names.map(m => <option key={m} value={m}>{m}</option>)}</select>
            <div className="f-hint">Defaults to you. Change it if you're entering for a teammate.</div>
          </div>
        </>}

        {step === 2 && <>
          <div className="caps">Met with</div>
          <div className="f-field"><label className="f-label">Name *</label><input className={field('metName')} value={d.metName || ''} onChange={set('metName')} placeholder="Who you met" /><E k="metName" /></div>
          <div className="f-field"><label className="f-label">Role</label><input className="f-input" value={d.metRole || ''} onChange={set('metRole')} placeholder="e.g. Principal, Teacher" /></div>
          <div style={{ height: 1, background: 'var(--line-2)', margin: '4px 0' }} />
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="caps">School coordinator</div>
            <button className="link-btn" style={{ fontSize: 13 }} onClick={() => { setD(x => ({ ...x, coordName: x.metName || '' })); setErr(x => ({ ...x, coordName: '' })); }}>Same as met</button>
          </div>
          <div className="f-field"><label className="f-label">Coordinator name *</label><input className={field('coordName')} value={d.coordName || ''} onChange={set('coordName')} placeholder="Point of contact at school" /><E k="coordName" /></div>
          <div className="f-field"><label className="f-label">Phone</label><input type="tel" inputMode="tel" className={field('coordPhone')} value={d.coordPhone || ''} onChange={set('coordPhone')} placeholder="+91" /><E k="coordPhone" /></div>
          <div className="f-field"><label className="f-label">Email</label><input type="email" inputMode="email" className={field('coordEmail')} value={d.coordEmail || ''} onChange={set('coordEmail')} placeholder="name@school.edu" /><E k="coordEmail" /></div>
        </>}

        {step === 3 && <>
          <div className="f-field"><label className="f-label">Notes / outcome</label><textarea className="f-input" rows={5} value={d.notes || ''} onChange={set('notes')} placeholder="What was discussed, agreed, next steps" /></div>
          <div className="f-field" style={{ gap: 8 }}>
            <label className="f-label">Visit status *</label>
            <div className="status-pick">
              <button className={d.status === 'done' ? 'on' : ''} onClick={() => setD(x => ({ ...x, status: 'done' }))}>Done</button>
              <button className={d.status === 'followup' ? 'on' : ''} onClick={() => setD(x => ({ ...x, status: 'followup', followUp: x.followUp || ago(-7) }))}>Follow-up needed</button>
            </div>
          </div>
          {d.status === 'followup' && (
            <div className="f-field"><label className="f-label">Follow-up date *</label><input type="date" className={field('followUp')} style={{ fontSize: 15, padding: '0 10px' }} value={d.followUp || ''} onChange={set('followUp')} /><E k="followUp" /></div>
          )}
          <div className="review">
            <div style={{ fontWeight: 600, marginBottom: 2 }}>{d.school}</div>
            <div>{[d.zone && zoneShort(d.zone), d.location, dLabel(d.date), d.by, d.metName && 'met ' + d.metName, classTotal && fmtNum(classTotal) + ' students'].filter(Boolean).join(' · ')}</div>
          </div>
        </>}
      </div>

      <div className="form-foot">
        {step > 0 && <button className="btn-ghost" onClick={() => { setStep(step - 1); setErr({}); }}>Back</button>}
        <button className="btn-primary" style={{ flex: 1 }} onClick={next}>{step === 3 ? (fs.online ? 'Save visit' : 'Save offline') : 'Next'}</button>
      </div>
    </div>
  );
}

function Detail({ fs, id, back, flash }: { fs: FS; id: string; back: () => void; flash: (m: string) => void }) {
  const v = fs.visits.find(x => x.id === id);
  if (!v) return <div className="detail-body"><button className="link-btn" onClick={back}>← Visits</button><div className="empty">This visit is no longer available.</div></div>;
  const rows = classRows(v.classCounts);
  const rowsKv = [
    ['Zone', v.zone || '—'],
    ['Date', dLabel(v.date, true) + (v.time ? ', ' + v.time : '')],
    ['Visited by', v.by],
    ['Met with', v.metName + (v.metRole ? ' (' + v.metRole + ')' : '')],
    ['Students', v.students ? fmtNum(v.students) : '—']
  ];
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
      <div className="detail-head">
        <button className="link-btn" style={{ fontSize: 16, fontWeight: 400, height: 36 }} onClick={back}>← Visits</button>
        <h2>{v.school}</h2>
        <div style={{ fontSize: 14, color: 'var(--ink-3)', marginTop: 4 }}>{v.location}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}><Badges v={v} /></div>
      </div>
      <div className="detail-body">
        <div className="card">{rowsKv.map(([k, val]) => <div className="kv" key={k}><span>{k}</span><span>{val}</span></div>)}</div>
        {rows.length > 0 && (
          <div className="card" style={{ padding: 14 }}>
            <div className="caps">Students per class</div>
            <div className="class-grid" style={{ gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: 8, marginTop: 10 }}>
              {rows.map(r => <div key={r.k}><div className="k">{r.k}</div><div className="v" style={{ fontSize: 15 }}>{r.v}</div></div>)}
            </div>
          </div>
        )}
        <div className="card" style={{ padding: 14 }}>
          <div className="caps">School coordinator</div>
          <div style={{ fontSize: 16, fontWeight: 600, marginTop: 6 }}>{v.coordName}</div>
          <div style={{ fontSize: 14, color: 'var(--ink-3)', marginTop: 2 }}>{[v.coordPhone, v.coordEmail].filter(Boolean).join(' · ') || 'No contact details'}</div>
          <div className="actions">
            <a className={v.coordPhone ? '' : 'disabled'} href={v.coordPhone ? 'tel:' + v.coordPhone.replace(/\s/g, '') : undefined}>Call</a>
            <a className={v.coordEmail ? '' : 'disabled'} href={v.coordEmail ? 'mailto:' + v.coordEmail : undefined}>Email</a>
          </div>
        </div>
        <div className="card" style={{ padding: 14 }}>
          <div className="caps">Notes / outcome</div>
          <div style={{ fontSize: 15, lineHeight: 1.5, marginTop: 6, whiteSpace: 'pre-wrap', textWrap: 'pretty' } as CSSProperties}>{v.notes || 'No notes added.'}</div>
        </div>
        {v.status === 'followup' && (
          <button className="btn-primary" style={{ height: 50 }} onClick={() => { fs.updateVisit(v.id, { status: 'done', followUp: '' }); flash('Marked as done'); }}>Mark follow-up done</button>
        )}
      </div>
    </div>
  );
}
