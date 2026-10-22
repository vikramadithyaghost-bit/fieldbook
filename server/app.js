import express from 'express';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';
import { iso, validateVisit } from '../shared/domain.js';
import { rowToVisit, cleanVisit, insertVisit } from './db.js';

const MAX_FAILS = 5, LOCK_MS = 5 * 60 * 1000;

export function createApp(db, { adminPin = '0000' } = {}) {
  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // --- PIN brute-force protection: 5 wrong attempts per IP + account locks it for 5 minutes.
  const fails = new Map();
  const lockedFor = key => { const f = fails.get(key); return f && f.until > Date.now() ? Math.ceil((f.until - Date.now()) / 60000) : 0; };
  const fail = key => { const f = fails.get(key) || { n: 0, until: 0 }; f.n += 1; if (f.n >= MAX_FAILS) { f.n = 0; f.until = Date.now() + LOCK_MS; } fails.set(key, f); };

  const newSession = (role, memberId) => {
    const token = randomBytes(24).toString('base64url');
    db.prepare('INSERT INTO sessions (token, role, member_id, created_at) VALUES (?, ?, ?, ?)').run(token, role, memberId, new Date().toISOString());
    return token;
  };
  const activeMembers = () => db.prepare('SELECT id, name, pin, added FROM members WHERE active = 1 ORDER BY name COLLATE NOCASE').all().map(m => ({ ...m }));
  const genPin = not => {
    const used = new Set(activeMembers().map(m => m.pin));
    let p;
    do { p = String(randomInt(10000)).padStart(4, '0'); } while (used.has(p) || p === not || p === adminPin);
    return p;
  };

  const auth = role => (req, res, next) => {
    const token = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    const s = token && db.prepare(`SELECT s.role, s.member_id, m.name, m.active FROM sessions s LEFT JOIN members m ON m.id = s.member_id WHERE s.token = ?`).get(token);
    if (!s || (s.role === 'member' && !s.active)) return res.status(401).json({ error: 'Please sign in again' });
    if (role === 'admin' && s.role !== 'admin') return res.status(403).json({ error: 'Admins only' });
    req.session = { token, role: s.role, memberId: s.member_id, name: s.name };
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
    const m = db.prepare('SELECT id, name, pin FROM members WHERE active = 1 AND name = ? COLLATE NOCASE').get(name);
    if (!m || m.pin !== pin) { fail(key); return res.status(401).json({ error: 'Incorrect PIN. Ask your admin to reset it.' }); }
    fails.delete(key);
    res.json({ token: newSession('member', m.id), user: { id: m.id, name: m.name } });
  });

  app.post('/api/admin/login', (req, res) => {
    const key = req.ip + '|admin', wait = lockedFor(key);
    if (wait) return res.status(429).json({ error: `Too many attempts. Try again in ${wait} min.` });
    if (String(req.body?.pin || '') !== adminPin) { fail(key); return res.status(401).json({ error: 'Incorrect admin PIN' }); }
    fails.delete(key);
    res.json({ token: newSession('admin', null) });
  });

  app.post('/api/logout', auth(), (req, res) => {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(req.session.token);
    res.json({ ok: true });
  });

  app.get('/api/me', auth(), (req, res) => res.json({ role: req.session.role, user: req.session.memberId ? { id: req.session.memberId, name: req.session.name } : null }));

  // --- Visits: everyone signed in sees every visit.
  app.get('/api/visits', auth(), (req, res) => {
    res.json(db.prepare('SELECT * FROM visits ORDER BY date DESC, time DESC').all().map(rowToVisit));
  });

  // Idempotent on the client-generated id, so a visit queued offline can be retried safely.
  app.post('/api/visits', auth(), (req, res) => {
    const v = cleanVisit({ ...req.body, id: req.body?.id || 'v-' + randomUUID() });
    const existing = db.prepare('SELECT * FROM visits WHERE id = ?').get(v.id);
    if (existing) return res.json(rowToVisit(existing));
    const errors = validateVisit(v);
    if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], errors });
    insertVisit(db, v, req.session.memberId);
    res.status(201).json(rowToVisit(db.prepare('SELECT * FROM visits WHERE id = ?').get(v.id)));
  });

  app.patch('/api/visits/:id', auth(), (req, res) => {
    const row = db.prepare('SELECT * FROM visits WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Visit not found' });
    const v = cleanVisit({ ...rowToVisit(row), ...req.body, id: row.id });
    const errors = validateVisit(v);
    if (Object.keys(errors).length) return res.status(400).json({ error: Object.values(errors)[0], errors });
    db.prepare(`UPDATE visits SET date=?, time=?, school=?, location=?, zone=?, class_counts=?, students=?, by_name=?, met_name=?, met_role=?, coord_name=?, coord_phone=?, coord_email=?, notes=?, status=?, follow_up=?, updated_at=? WHERE id=?`)
      .run(v.date, v.time, v.school, v.location, v.zone, JSON.stringify(v.classCounts), v.students, v.by, v.metName, v.metRole, v.coordName, v.coordPhone, v.coordEmail, v.notes, v.status, v.followUp, new Date().toISOString(), v.id);
    res.json(rowToVisit(db.prepare('SELECT * FROM visits WHERE id = ?').get(v.id)));
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
    res.status(201).json(db.prepare('SELECT id, name, pin, added FROM members WHERE id = ?').get(id));
  });

  app.post('/api/members/:id/reset-pin', auth('admin'), (req, res) => {
    const m = db.prepare('SELECT id, pin FROM members WHERE id = ? AND active = 1').get(req.params.id);
    if (!m) return res.status(404).json({ error: 'Member not found' });
    const pin = genPin(m.pin);
    db.prepare('UPDATE members SET pin = ? WHERE id = ?').run(pin, m.id);
    db.prepare('DELETE FROM sessions WHERE member_id = ?').run(m.id);
    res.json(db.prepare('SELECT id, name, pin, added FROM members WHERE id = ?').get(m.id));
  });

  // Removing blocks sign-in (and ends open sessions) but keeps the member's past visits.
  app.delete('/api/members/:id', auth('admin'), (req, res) => {
    const r = db.prepare('UPDATE members SET active = 0 WHERE id = ? AND active = 1').run(req.params.id);
    if (!r.changes) return res.status(404).json({ error: 'Member not found' });
    db.prepare('DELETE FROM sessions WHERE member_id = ?').run(req.params.id);
    res.json({ ok: true });
  });

  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
  return app;
}
