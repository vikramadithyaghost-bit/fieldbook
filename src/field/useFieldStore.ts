import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Member, Visit } from '../../shared/domain';
import { api, ApiError, save, store } from '../lib/api';

// Offline-first: visits are cached on the device and every write goes into an outbox
// that is replayed against the server whenever a connection is available.
type Patch = Partial<Visit> & { removePhotos?: string[] };
type Op = { kind: 'create'; visit: Visit } | { kind: 'update'; id: string; patch: Patch } | { kind: 'delete'; id: string };
interface Auth { token: string; user: { id: string; name: string; canEditAll?: boolean } }

const K = { auth: 'fieldbook-auth', visits: 'fieldbook-visits-cache', outbox: 'fieldbook-outbox', team: 'fieldbook-team-cache' };

export function useFieldStore(flash: (msg: string) => void) {
  const [auth, setAuthState] = useState<Auth | null>(() => store(K.auth, null));
  const [serverVisits, setServerVisits] = useState<Visit[]>(() => store(K.visits, []));
  const [outbox, setOutboxState] = useState<Op[]>(() => store(K.outbox, []));
  const [team, setTeam] = useState<Member[]>(() => store(K.team, []));
  const [online, setOnline] = useState(() => navigator.onLine);
  const [syncing, setSyncing] = useState(false);
  const busy = useRef(false), outboxRef = useRef(outbox), authRef = useRef(auth);
  outboxRef.current = outbox;
  authRef.current = auth;

  const setOutbox = (next: Op[]) => { outboxRef.current = next; setOutboxState(next); return save(K.outbox, next); };
  const setAuth = (a: Auth | null) => { authRef.current = a; save(K.auth, a); setAuthState(a); };

  const loadTeam = useCallback(async () => {
    try {
      const t = await api<Member[]>('/team');
      save(K.team, t);
      setTeam(t);
      setOnline(true);
    } catch (e) {
      if (e instanceof ApiError && e.status === 0) setOnline(false);
    }
  }, []);

  const signOut = useCallback((reason?: string) => {
    const a = authRef.current;
    if (a) api('/logout', { method: 'POST', token: a.token }).catch(() => {});
    setAuth(null);
    if (reason) flash(reason);
  }, [flash]);

  const sync = useCallback(async () => {
    const a = authRef.current;
    if (!a || busy.current) return;
    busy.current = true;
    setSyncing(true);
    let sent = 0;
    try {
      while (outboxRef.current.length) {
        const op = outboxRef.current[0];
        try {
          if (op.kind === 'create') await api('/visits', { body: op.visit, token: a.token });
          else if (op.kind === 'update') await api('/visits/' + encodeURIComponent(op.id), { method: 'PATCH', body: op.patch, token: a.token });
          else await api('/visits/' + encodeURIComponent(op.id), { method: 'DELETE', token: a.token });
          sent++;
        } catch (e) {
          if (!(e instanceof ApiError) || e.status === 0 || e.status >= 500) throw e;
          if (e.status === 401) throw e;
          // Deleting something that's already gone is fine. Other bad changes would block the queue forever; drop them.
          if (!(op.kind === 'delete' && e.status === 404)) flash('A change was rejected: ' + e.message);
        }
        setOutbox(outboxRef.current.slice(1));
      }
      const [vs, t, me] = await Promise.all([api<Visit[]>('/visits', { token: a.token }), api<Member[]>('/team'), api<{ user: Auth['user'] | null }>('/me', { token: a.token })]);
      // Pick up permission changes the admin made since sign-in.
      if (me.user && authRef.current?.token === a.token && !!me.user.canEditAll !== !!a.user.canEditAll) setAuth({ ...a, user: { ...a.user, canEditAll: !!me.user.canEditAll } });
      save(K.visits, vs);
      save(K.team, t);
      setServerVisits(vs);
      setTeam(t);
      setOnline(true);
      if (sent) flash('All visits synced');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) signOut('Signed out · please sign in again');
      else setOnline(false);
    } finally {
      busy.current = false;
      setSyncing(false);
    }
  }, [flash, signOut]);

  useEffect(() => {
    const up = () => { setOnline(true); sync(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    const id = setInterval(() => { if (navigator.onLine) sync(); }, 60_000);
    return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); clearInterval(id); };
  }, [sync]);

  useEffect(() => { if (auth) sync(); else loadTeam(); }, [auth, sync, loadTeam]);

  const enqueue = (op: Op) => { const stored = setOutbox([...outboxRef.current, op]); setTimeout(sync, 0); return stored; };

  const visits = useMemo(() => {
    const byId = new Map(serverVisits.map(v => [v.id, v]));
    for (const op of outbox) {
      if (op.kind === 'create' && !byId.has(op.visit.id)) byId.set(op.visit.id, { ...op.visit, pending: true, photos: (op.visit.newPhotos || []).map((url, i) => ({ id: 'local-' + i, url })) });
      if (op.kind === 'update' && byId.has(op.id)) {
        const cur = byId.get(op.id)!, { removePhotos = [], newPhotos = [], ...fields } = op.patch;
        const photos = [...(cur.photos || []).filter(p => !removePhotos.includes(p.id)), ...newPhotos.map((url, i) => ({ id: `local-${op.id}-${i}-${url.length}`, url }))];
        byId.set(op.id, { ...cur, ...fields, photos, pending: true });
      }
      if (op.kind === 'delete') byId.delete(op.id);
    }
    return [...byId.values()].sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  }, [serverVisits, outbox]);

  return {
    auth, team, visits, online, syncing, pending: outbox.length,
    sync, loadTeam, signOut,
    signIn: async (name: string, pin: string) => {
      const r = await api<Auth>('/login', { body: { name, pin } });
      setAuth(r);
      return r;
    },
    addVisit: (v: Visit) => enqueue({ kind: 'create', visit: { ...v, createdBy: authRef.current?.user.id } }),
    isQueued: (id: string) => outboxRef.current.some(op => op.kind === 'create' && op.visit.id === id),
    /** Visits this person entered (or queued on this phone) can be edited and deleted by them. */
    isMine: (v: Visit) => !!auth && v.createdBy === auth.user.id,
    /** Your own visits, or anyone's if the admin allowed you to edit all visits. */
    canEdit: (v: Visit) => !!auth && (v.createdBy === auth.user.id || !!auth.user.canEditAll),
    deleteVisit: (id: string) => {
      const queued = outboxRef.current.some(op => op.kind === 'create' && op.visit.id === id);
      const rest = outboxRef.current.filter(op => !(op.kind === 'create' && op.visit.id === id) && !(op.kind === 'update' && op.id === id));
      if (queued) { setOutbox(rest); return true; } // Never uploaded: just drop it.
      const stored = setOutbox([...rest, { kind: 'delete', id }]);
      setTimeout(sync, 0);
      return stored;
    },
    updateVisit: (id: string, patch: Patch) => {
      const queued = outboxRef.current.findIndex(op => op.kind === 'create' && op.visit.id === id);
      if (queued >= 0) { // Not uploaded yet: just amend the queued create.
        const next = [...outboxRef.current], op = next[queued] as Extract<Op, { kind: 'create' }>;
        const { removePhotos: _r, ...fields } = patch;
        next[queued] = { kind: 'create', visit: { ...op.visit, ...fields } };
        const stored = setOutbox(next);
        setTimeout(sync, 0);
        return stored;
      }
      return enqueue({ kind: 'update', id, patch });
    }
  };
}
