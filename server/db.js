import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { ago } from '../shared/domain.js';
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
      status TEXT NOT NULL CHECK (status IN ('done', 'followup')),
      follow_up TEXT NOT NULL DEFAULT '',
      created_by TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS visits_date ON visits(date);
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
      member_id TEXT REFERENCES members(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL
    );
  `);
  return db;
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
    notes: r.notes, status: r.status, followUp: r.follow_up
  };
}

const str = (x, max = 500) => String(x ?? '').trim().slice(0, max);

/** Normalises client input into a storable visit. */
export function cleanVisit(v) {
  const students = str(v.students, 12).replace(/[\s,]/g, '');
  const status = v.status === 'followup' ? 'followup' : 'done';
  return {
    id: str(v.id, 64), date: str(v.date, 10), time: str(v.time, 5), school: str(v.school, 200), location: str(v.location, 200), zone: str(v.zone, 60),
    students: /^\d+$/.test(students) ? String(+students) : students,
    by: str(v.by, 100), metName: str(v.metName, 100), metRole: str(v.metRole, 100), coordName: str(v.coordName, 100),
    coordPhone: str(v.coordPhone, 30), coordEmail: str(v.coordEmail, 200), notes: str(v.notes, 5000),
    status, followUp: status === 'followup' ? str(v.followUp, 10) : ''
  };
}

export function insertVisit(db, v, createdBy) {
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO visits (id, date, time, school, location, zone, class_counts, students, by_name, met_name, met_role, coord_name, coord_phone, coord_email, notes, status, follow_up, created_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(v.id, v.date, v.time, v.school, v.location, v.zone, '{}', v.students, v.by, v.metName, v.metRole, v.coordName, v.coordPhone, v.coordEmail, v.notes, v.status, v.followUp, createdBy, now, now);
}
