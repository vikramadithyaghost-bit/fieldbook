import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { STATUSES, ago } from '../shared/domain.js';
import { SEED_TEAM, SEED_PINS, seedVisits } from './seed.js';

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS members (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      pin TEXT NOT NULL,
      active INTEGER NOT NULL DEFAULT 1,
      added TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS visits (
      id TEXT PRIMARY KEY,
      date TEXT NOT NULL,
      time TEXT NOT NULL DEFAULT '',
      school TEXT NOT NULL,
      location TEXT NOT NULL,
      zone TEXT NOT NULL,
      class_counts TEXT NOT NULL DEFAULT '{}',
      students TEXT NOT NULL DEFAULT '',
      by_name TEXT NOT NULL,
      met_name TEXT NOT NULL,
      met_role TEXT NOT NULL DEFAULT '',
      coord_name TEXT NOT NULL,
      coord_phone TEXT NOT NULL DEFAULT '',
      coord_email TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL CHECK (status IN ('done', 'followup', 'notinterested')),
      follow_up TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS visits_date ON visits(date);
    CREATE TABLE IF NOT EXISTS photos (
      id TEXT PRIMARY KEY,
      visit_id TEXT NOT NULL REFERENCES visits(id) ON DELETE CASCADE,
      mime TEXT NOT NULL,
      data BLOB NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS photos_visit ON photos(visit_id);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
  `);
  allowNotInterested(db);
  // Columns added after go-live: school GPS position.
  const cols = new Set(db.prepare('PRAGMA table_info(visits)').all().map(c => c.name));
  // Members the admin allows to edit everyone's visits (e.g. a supervisor).
  if (!db.prepare('PRAGMA table_info(members)').all().some(c => c.name === 'can_edit_all')) db.exec('ALTER TABLE members ADD COLUMN can_edit_all INTEGER NOT NULL DEFAULT 0');
  if (!cols.has('lat')) db.exec('ALTER TABLE visits ADD COLUMN lat REAL; ALTER TABLE visits ADD COLUMN lng REAL; ALTER TABLE visits ADD COLUMN geo_acc REAL;');
  return db;
}

/**
 * Databases created before "Not interested" existed have a CHECK constraint that only allows
 * done/followup. SQLite can't alter a CHECK, so rebuild the table once, keeping every row and
 * every photo (foreign keys are paused so the photos' ON DELETE CASCADE doesn't fire).
 */
function allowNotInterested(db) {
  const { sql } = db.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'visits'").get();
  if (sql.includes('notinterested')) return;
  const cols = db.prepare('PRAGMA table_info(visits)').all().map(c => c.name).join(', ');
  db.exec('PRAGMA foreign_keys = OFF');
  try {
    db.exec('BEGIN');
    db.exec(sql.replace(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"?visits"?/i, 'CREATE TABLE visits_new').replace("IN ('done', 'followup')", "IN ('done', 'followup', 'notinterested')"));
    db.exec(`INSERT INTO visits_new (${cols}) SELECT ${cols} FROM visits; DROP TABLE visits; ALTER TABLE visits_new RENAME TO visits;
      CREATE INDEX IF NOT EXISTS visits_date ON visits(date);`);
    if (db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Foreign key check failed while upgrading visits');
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  } finally {
    db.exec('PRAGMA foreign_keys = ON');
  }
}

// One-off data resets that run once per database on the next start after they ship.
const RESETS = [
  ['2026-10-22-clear-visits', 'DELETE FROM visits'] // Clear test visits before going live; team members are kept.
];
export function runResets(db) {
  const done = db.prepare('SELECT 1 FROM meta WHERE key = ?'), mark = db.prepare('INSERT INTO meta (key, value) VALUES (?, ?)');
  const ran = [];
  for (const [key, sql] of RESETS) {
    if (done.get(key)) continue;
    db.exec(sql);
    mark.run(key, new Date().toISOString());
    ran.push(key);
  }
  return ran;
}

export function seedIfEmpty(db) {
  if (db.prepare('SELECT COUNT(*) AS n FROM members').get().n) return false;
  const addM = db.prepare('INSERT INTO members (id, name, pin, active, added) VALUES (?, ?, ?, 1, ?)');
  SEED_TEAM.forEach((name, i) => addM.run('m' + (i + 1), name, SEED_PINS[i], ago(60)));
  seedVisits().forEach(v => insertVisit(db, v, null));
  return true;
}

export function rowToVisit(r) {
  return {
    id: r.id, date: r.date, time: r.time, school: r.school, location: r.location, zone: r.zone, students: r.students,
    by: r.by_name, metName: r.met_name, metRole: r.met_role, coordName: r.coord_name, coordPhone: r.coord_phone, coordEmail: r.coord_email,
    notes: r.notes, status: r.status, followUp: r.follow_up, createdBy: r.created_by || null,
    geo: r.lat == null ? null : { lat: r.lat, lng: r.lng, acc: r.geo_acc ?? 0 }
  };
}

/** Accepts {lat, lng, acc} with sane ranges; anything else means "no location". */
export function cleanGeo(g) {
  if (!g || typeof g !== 'object') return null;
  const lat = Number(g.lat), lng = Number(g.lng), acc = Number(g.acc) || 0;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat: +lat.toFixed(6), lng: +lng.toFixed(6), acc: Math.max(0, Math.round(acc)) };
}

const str = (x, max = 500) => String(x ?? '').trim().slice(0, max);

/** Normalises client input into a storable visit. */
export function cleanVisit(v) {
  const students = str(v.students, 12).replace(/[\s,]/g, '');
  // Unknown values are kept so validation rejects them; a missing status means done.
  const status = !v.status ? 'done' : STATUSES.includes(v.status) ? v.status : str(v.status, 20);
  return {
    id: str(v.id, 64), date: str(v.date, 10), time: str(v.time, 5), school: str(v.school, 200), location: str(v.location, 200), zone: str(v.zone, 60),
    students: /^\d+$/.test(students) ? String(+students) : students,
    by: str(v.by, 100), metName: str(v.metName, 100), metRole: str(v.metRole, 100), coordName: str(v.coordName, 100),
    coordPhone: str(v.coordPhone, 30), coordEmail: str(v.coordEmail, 200), notes: str(v.notes, 5000),
    status, followUp: status === 'followup' ? str(v.followUp, 10) : '',
    geo: cleanGeo(v.geo)
  };
}

export function insertVisit(db, v, createdBy) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO visits (id, date, time, school, location, zone, class_counts, students, by_name, met_name, met_role, coord_name, coord_phone, coord_email, notes, status, follow_up, lat, lng, geo_acc, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(v.id, v.date, v.time, v.school, v.location, v.zone, '{}', v.students, v.by, v.metName, v.metRole, v.coordName, v.coordPhone, v.coordEmail, v.notes, v.status, v.followUp, v.geo?.lat ?? null, v.geo?.lng ?? null, v.geo?.acc ?? null, createdBy, now, now);
}
