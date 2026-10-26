import express from 'express';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { iso, validateVisit } from '../shared/domain.js';
import { rowToVisit, cleanVisit, insertVisit } from './db.js';
import { listActivity, logActivity, visitChanges } from './activity.js';

const MAX_FAILS = 5, LOCK_MS = 5 * 60 * 1000;
const MAX_PHOTOS = 4, MAX_PHOTO_BYTES = 3 * 1024 * 1024;

/** Decodes the data-URL photos a phone sends. Throws a user-facing message on bad input. */
function decodePhotos(list) {
  if (list == null) return [];
  if (!Array.isArray(list)) throw new Error('Photos must be a list');
  return list.map(u => {
    const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(u));
    if (!m) throw new Error('Photos must be JPEG, PNG or WebP images');
    const data = Buffer.from(m[2], 'base64');
    if (data.length > MAX_PHOTO_BYTES) throw new Error('A photo is too large');
    return { mime: m[1], data };
  });
}

export function createApp(db, { adminPin = '0000' } = {}) {
  const app = express();
  app.use(express.json({ limit: '20mb' })); // Room for a visit with its photos.

  // --- PIN brute-force protection: 5 wrong attempts per IP + account locks it for 5 minutes.
  const fails = new Map();
  const lockedFor = key => { const f = fails.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0; };
  const fail = key => { const f = fails.get(key) || { n: 0, until: 0 }; f.n += 1; let locked = false; if (f.n >= MAX_FAILS) { f.n = 0; f.until = Date.now() + LOCK_MS; locked = true; } fails.set(key, f); return locked; };
  const log = (who, action, target, details) => logActivity(db, who, action, target, details);

  const newSession = (role, memberId) => {
    const token = randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO sessions (token, role, member_id, created_at) VALUES (?, ?, ?, ?)').run(token, role, memberId, new Date().toISOString());
    return token;
  };
  const memberOut = m => m && ({ id: m.id, name: m.name, pin: m.pin, added: m.added, canEditAll: !!m.can_edit_all });
  const activeMembers = () => db.prepare('SELECT id, name, pin, added, can_edit_all FROM members WHERE active = 1 ORDER BY name COLLATE NOCASE').all().map(memberOut);
  const memberById = id => memberOut(db.prepare('SELECT id, name, pin, added, can_edit_all FROM members WHERE id = ?').get(id));
  const genPin = not => {
    const used = new Set(activeMembers().map(m => m.pin));
    let p;
    do { p = String(randomInt(10000)).padStart(4, '0'); } while (used.has(p) || p === not || p === adminPin);
    return p;
  };

  const auth = role => (req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const s = token && db.prepare(`SELECT s.role, s.member_id, m.name, m.active, m.can_edit_all FROM sessions s LEFT JOIN members m ON m.id = s.member_id WHERE s.token = ?`).get(token);
    if (!s || (s.role === 'member' && !s.active)) return res.status(401).json({ error: 'Please sign in again' });
    if (role === 'admin' && s.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    req.session = { token, role: s.role, memberId: s.member_id, name: s.name, editAll: !!s.can_edit_all };
    next();
  };

  app.get('/api/health', (req, res) => res.json({ ok: true }));

  // Names only — used to fill the "Who are you?" picker on the mobile sign-in screen.
  app.get('/api/team', (req, res) => res.json(activeMembers().map(({ id, name }) => ({ id, name }))));

  app.post('/api/login', (req, res) => {
    const name = String(req.body?.name || ''), pin = String(req.body?.pin || '');
    if (!name) return res.status(400).json({ error: 'Select your name' });
    if (!/^\d{4}$/.test(pin)) return res.status(400).json({ error: 'Enter your 4-digit PIN' });
    const key = req.ip + '|' + name.toLowerCase(), wait = lockedFor(key);
    if (wait) return res.status(429).json({ error: `Too many attempts. Try again in ${wait} min.` });
    const m = db.prepare('SELECT id, name, pin, can_edit_all FROM members WHERE active = 1 AND name = ? COLLATE NOCASE').get(name);
    if (!m || m.pin !== pin) {
      const who = { role: m ? 'member' : 'unknown', id: m?.id, name: m?.name || name.slice(0, 100) };
      log(who, 'signin.failed');
      if (fail(key)) log(who, 'signin.locked');
      return res.status(401).json({ error: 'Incorrect PIN. Ask your admin to reset it.' });
    }
    fails.delete(key);
    log({ role: 'member', id: m.id, name: m.name }, 'signin');
    res.json({ token: newSession('member', m.id), user: { id: m.id, name: m.name, canEditAll: !!m.can_edit_all } });
  });

  app.post('/api/admin/login', (req, res) => {
    const key = req.ip + '|admin', wait = lockedFor(key);
    if (wait) return res.status(429).json({ error: `Too many attempts. Try again in ${wait} min.` });
    if (String(req.body?.pin || '') !== adminPin) {
      log({ role: 'unknown', name: 'Someone' }, 'admin.signin.failed');
      if (fail(key)) log({ role: 'unknown', name: 'Someone' }, 'admin.signin.locked');
      return res.status(401).json({ error: 'Incorrect admin PIN' });
    }
    fails.delete(key);
    log({ role: 'admin' }, 'admin.signin');
    res.json({ token: newSession('admin', null) });
  });

  app.post('/api/logout', auth(), (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.session.token);
    log(req.session, 'signout');
    res.json({ ok: true });
  });

  app.get('/api/me', auth(), (req, res) => res.json({ role: req.session.role, user: req.session.memberId ? { id: req.session.memberId, name: req.session.name, canEditAll: req.session.editAll } : null }));

  // Photos are listed on each visit as URLs; the bytes are served separately.
  const photosOf = id => db.prepare('SELECT id FROM photos WHERE visit_id = ? ORDER BY created_at, id').all(id).map(p => ({ id: p.id, url: '/api/photos/' + p.id }));
  const getVisit = id => { const r = db.prepare('SELECT * FROM visits WHERE id = ?').get(id); return r && { ...rowToVisit(r), photos: photosOf(id) }; };
  const addPhotos = (visitId, photos) => {
    const ins = db.prepare('INSERT INTO photos (id, visit_id, mime, data, created_at) VALUES (?, ?, ?, ?, ?)');
    photos.forEach(p => ins.run(randomUUID(), visitId, p.mime, p.data, new Date().toISOString()));
  };

  // --- Visits: everyone signed in sees every visit.
  app.get('/api/visits', auth(), (req, res) => {
    const byVisit = new Map();
    for (const p of db.prepare('SELECT id, visit_id FROM photos ORDER BY created_at, id').all()) {
      if (!byVisit.has(p.visit_id)) byVisit.set(p.visit_id, []);
      byVisit.get(p.visit_id).push({ id: p.id, url: '/api/photos/' + p.id });
    }
    res.json(db.prepare('SELECT * FROM visits ORDER BY date DESC, time DESC').all().map(r => ({ ...rowToVisit(r), photos: byVisit.get(r.id) || [] })));
  });

  // Photo ids are random UUIDs, so an <img> can load them without a sign-in header.
  app.get('/api/photos/:id', (req, res) => {
    const p = db.prepare('SELECT mime, data FROM photos WHERE id = ?').get(req.params.id);
    if (!p) return res.status(404).json({ error: 'Photo not found' });
    res.set('Cache-Control', 'private, max-age=31536000, immutable').type(p.mime).send(Buffer.from(p.data));
  });

  // Idempotent on the client-generated id, so a visit queued offline can be retried safely.
  app.post('/api/visits', auth(), (req, res) => {
    const v = cleanVisit({ ...req.body, id: req.body?.id || 'v-' + randomUUID() });
    const existing = getVisit(v.id);
    if (existing) return res.json(existing);
    const errors = validateVisit(v);
    if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], errors });
    let photos;
    try { photos = decodePhotos(req.body.newPhotos); } catch (e) { return res.status(400).json({ error: e.message }); }
    if (photos.length > MAX_PHOTOS) return res.status(400).json({ error: `Up to ${MAX_PHOTOS} photos per visit` });
    db.exec('BEGIN');
    try { insertVisit(db, v, req.session.memberId); addPhotos(v.id, photos); db.exec('COMMIT'); } catch (e) { db.exec('ROLLBACK'); throw e; }
    log(req.session, 'visit.create', { id: v.id, label: v.school },
      { date: v.date, zone: v.zone, status: v.status, followUp: v.followUp, visitedBy: v.by, photos: photos.length, located: !!v.geo });
    res.status(201).json(getVisit(v.id));
  });

  // The admin can change any visit; a member can change the visits they entered.
  // Anyone signed in may still mark a follow-up as done.
  const isAuthor = (s, row) => s.role === 'admin' || (!!row.created_by && row.created_by === s.memberId);
  // Members the admin marked "Can edit all visits" may edit anyone's visit; deleting stays with the author.
  const canEdit = (s, row) => isAuthor(s, row) || s.editAll;
  const isMarkDone = body => Object.keys(body || {}).every(k => k === 'status' || k === 'followUp') && body.status === 'done';

  app.patch('/api/visits/:id', auth(), (req, res) => {
    const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Visit not found' });
    if (!canEdit(req.session, row) && !isMarkDone(req.body)) return res.status(403).json({ error: 'You can only edit visits you entered' });
    const v = cleanVisit({ ...rowToVisit(row), ...req.body, id: row.id });
    const errors = validateVisit(v);
    if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], errors });
    const remove = Array.isArray(req.body.removePhotos) ? req.body.removePhotos.map(String) : [];
    let photos;
    try { photos = decodePhotos(req.body.newPhotos); } catch (e) { return res.status(400).json({ error: e.message }); }
    const kept = photosOf(v.id).filter(p => !remove.includes(p.id)).length;
    if (kept + photos.length > MAX_PHOTOS) return res.status(400).json({ error: `Up to ${MAX_PHOTOS} photos per visit` });
    let removed = 0;
    db.exec('BEGIN');
    try {
      db.prepare(`UPDATE visits SET date=?, time=?, school=?, location=?, zone=?, students=?, by_name=?, met_name=?, met_role=?, coord_name=?, coord_phone=?, coord_email=?, notes=?, status=?, follow_up=?, lat=?, lng=?, geo_acc=?, updated_at=? WHERE id=?`)
        .run(v.date, v.time, v.school, v.location, v.zone, v.students, v.by, v.metName, v.metRole, v.coordName, v.coordPhone, v.coordEmail, v.notes, v.status, v.followUp,
          v.geo?.lat ?? null, v.geo?.lng ?? null, v.geo?.acc ?? null, new Date().toISOString(), v.id);
      const del = db.prepare('DELETE FROM photos WHERE id = ? AND visit_id = ?');
      remove.forEach(id => { removed += del.run(id, v.id).changes; });
      addPhotos(v.id, photos);
      db.exec('COMMIT');
    } catch (e) { db.exec('ROLLBACK'); throw e; }
    const changes = visitChanges(rowToVisit(row), v);
    if (changes.length || photos.length || removed) {
      const markDone = isMarkDone(req.body) && row.status === 'followup';
      const onBehalf = !isAuthor(req.session, row) && !markDone; // edited someone else's visit ("Edit all visits")
      log(req.session, markDone ? 'visit.done' : 'visit.update', { id: v.id, label: v.school },
        { changes, photosAdded: photos.length, photosRemoved: removed, ...(onBehalf ? { onBehalf: true } : {}) });
    }
    res.json(getVisit(v.id));
  });

  app.delete('/api/visits/:id', auth(), (req, res) => {
    const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Visit not found' });
    if (!isAuthor(req.session, row)) return res.status(403).json({ error: 'You can only delete visits you entered' });
    const photoCount = db.prepare('SELECT COUNT(*) AS n FROM photos WHERE visit_id = ?').get(row.id).n;
    db.prepare('DELETE FROM visits WHERE id = ?').run(req.params.id);
    log(req.session, 'visit.delete', { id: row.id, label: row.school },
      { date: row.date, zone: row.zone, status: row.status, visitedBy: row.by_name, notes: row.notes.slice(0, 300), photos: photoCount });
    res.json({ ok: true });
  });

  // --- Team members (admin).
  app.get('/api/members', auth('admin'), (req, res) => res.json(activeMembers()));

  app.post('/api/members', auth('admin'), (req, res) => {
    const name = String(req.body?.name || '').trim().replace(/\s+/g, ' ').slice(0, 100);
    if (!name) return res.status(400).json({ error: 'Enter a name' });
    const prev = db.prepare('SELECT id, active FROM members WHERE name = ? COLLATE NOCASE').get(name);
    if (prev?.active) return res.status(409).json({ error: 'A member with this name already exists' });
    const pin = genPin();
    let id;
    if (prev) { // Re-adding someone who was removed keeps their identity; they get a fresh PIN.
      id = prev.id;
      db.prepare('UPDATE members SET active = 1, pin = ?, name = ?, added = ? WHERE id = ?').run(pin, name, iso(new Date()), id);
    } else {
      id = 'm-' + randomUUID();
      db.prepare('INSERT INTO members (id, name, pin, active, added) VALUES (?, ?, ?, 1, ?)').run(id, name, pin, iso(new Date()));
    }
    log(req.session, prev ? 'member.readd' : 'member.add', { id, label: name });
    res.status(201).json(memberById(id));
  });

  app.patch('/api/members/:id', auth('admin'), (req, res) => {
    if (typeof req.body?.canEditAll !== 'boolean') return res.status(400).json({ error: 'Nothing to change' });
    const r = db.prepare('UPDATE members SET can_edit_all = ? WHERE id = ? AND active = 1').run(req.body.canEditAll ? 1 : 0, req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Member not found' });
    const m = memberById(req.params.id);
    log(req.session, 'member.edit_all', { id: m.id, label: m.name }, { on: m.canEditAll });
    res.json(m);
  });

  app.post('/api/members/:id/reset-pin', auth('admin'), (req, res) => {
    const m = db.prepare('SELECT id, pin FROM members WHERE id = ? AND active = 1').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Member not found' });
    const pin = genPin(m.pin);
    db.prepare('UPDATE members SET pin = ? WHERE id = ?').run(pin, m.id);
    db.prepare('DELETE FROM sessions WHERE member_id = ?').run(m.id);
    const out = memberById(m.id);
    log(req.session, 'member.pin_reset', { id: m.id, label: out.name });
    res.json(out);
  });

  // Removing blocks sign-in (and ends open sessions) but keeps the member's past visits.
  app.delete('/api/members/:id', auth('admin'), (req, res) => {
    const r = db.prepare('UPDATE members SET active = 0 WHERE id = ? AND active = 1').run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Member not found' });
    db.prepare('DELETE FROM sessions WHERE member_id = ?').run(req.params.id);
    log(req.session, 'member.remove', { id: req.params.id, label: memberById(req.params.id)?.name });
    res.json({ ok: true });
  });

  // --- Activity log (admin).
  app.get('/api/activity', auth('admin'), (req, res) => {
    const { before, limit, actor, type, q } = req.query;
    res.json(listActivity(db, { before, limit, actor: actor && String(actor), type: type && String(type), q: q && String(q).slice(0, 100) }));
  });

  // Exports are built in the browser, so the dashboard reports them here.
  app.post('/api/activity/export', auth('admin'), (req, res) => {
    const format = req.body?.format === 'csv' ? 'csv' : 'xlsx', page = req.body?.page === 'schools' ? 'schools' : 'overview';
    log(req.session, 'export', null, { format, page, rows: Math.max(0, +req.body?.rows || 0), filters: String(req.body?.filters || '').slice(0, 200) });
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}
