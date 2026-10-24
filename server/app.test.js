import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, rowToVisit, runResets, seedIfEmpty } from './db.js';
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from './app.js';
import { ZONES, iso } from '../shared/domain.js';

let server, base;
before(async () => {
  const db = openDb(':memory:');
  seedIfEmpty(db);
  server = createApp(db, { adminPin: '0000' }).listen(0);
  await new Promise(r => server.once('listening', r));
  base = `http://localhost:${server.address().port}/api`;
});
after(() => server.close());

const req = async (path, { method, body, token } = {}) => {
  const r = await fetch(base + path, { method: method || (body ? 'POST' : 'GET'), headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body && JSON.stringify(body) });
  return { status: r.status, body: await r.json() };
};
const visit = (over = {}) => ({ id: 'v-test-' + Math.random(), school: 'Test School', location: 'Nagercoil', zone: ZONES[0], date: iso(new Date()), time: '10:00', by: 'Asha Verma', metName: 'HM', coordName: 'Coord', status: 'done', students: '1,250', ...over });

test('team list exposes names only', async () => {
  const { body } = await req('/team');
  assert.equal(body.length, 8);
  assert.deepEqual(Object.keys(body[0]).sort(), ['id', 'name']);
});

test('member login checks the PIN', async () => {
  assert.equal((await req('/login', { body: { name: 'Asha Verma', pin: '1111' } })).status, 401);
  const ok = await req('/login', { body: { name: 'asha verma', pin: '2468' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.user.name, 'Asha Verma');
});

test('visits need auth; create is idempotent and stores the student count', async () => {
  assert.equal((await req('/visits')).status, 401);
  const { token } = (await req('/login', { body: { name: 'Rahul Nair', pin: '1357' } })).body;
  const v = visit();
  const a = await req('/visits', { body: v, token });
  assert.equal(a.status, 201);
  assert.equal(a.body.students, '1250');
  const again = await req('/visits', { body: v, token });
  assert.equal(again.status, 200);
  const all = (await req('/visits', { token })).body;
  assert.equal(all.filter(x => x.id === v.id).length, 1);
});

test('invalid visits are rejected', async () => {
  const { token } = (await req('/login', { body: { name: 'Rahul Nair', pin: '1357' } })).body;
  const r = await req('/visits', { body: visit({ zone: 'Zone 9' }), token });
  assert.equal(r.status, 400);
  const r2 = await req('/visits', { body: visit({ status: 'followup', followUp: '' }), token });
  assert.equal(r2.status, 400);
});

test('mark follow-up done', async () => {
  const { token } = (await req('/login', { body: { name: 'Rahul Nair', pin: '1357' } })).body;
  const v = (await req('/visits', { body: visit({ status: 'followup', followUp: iso(new Date()) }), token })).body;
  const u = await req('/visits/' + v.id, { method: 'PATCH', body: { status: 'done', followUp: '' }, token });
  assert.equal(u.body.status, 'done');
  assert.equal(u.body.followUp, '');
});

test('admin manages members; reset and remove revoke sign-in', async () => {
  assert.equal((await req('/admin/login', { body: { pin: '1234' } })).status, 401);
  const { token } = (await req('/admin/login', { body: { pin: '0000' } })).body;
  const member = (await req('/login', { body: { name: 'Priya Singh', pin: '8024' } })).body;
  assert.equal((await req('/members', { token: member.token })).status, 403);

  const added = await req('/members', { body: { name: '  New   Person ' }, token });
  assert.equal(added.status, 201);
  assert.equal(added.body.name, 'New Person');
  assert.match(added.body.pin, /^\d{4}$/);
  assert.equal((await req('/members', { body: { name: 'new person' }, token })).status, 409);

  const priya = (await req('/members', { token })).body.find(m => m.name === 'Priya Singh');
  const reset = await req(`/members/${priya.id}/reset-pin`, { method: 'POST', token });
  assert.notEqual(reset.body.pin, '8024');
  assert.equal((await req('/visits', { token: member.token })).status, 401);

  const np = (await req('/login', { body: { name: 'New Person', pin: added.body.pin } })).body;
  assert.equal((await req('/members/' + added.body.id, { method: 'DELETE', token })).status, 200);
  assert.equal((await req('/visits', { token: np.token })).status, 401);
  assert.equal((await req('/login', { body: { name: 'New Person', pin: added.body.pin } })).status, 401);
});

test('members can edit and delete only the visits they entered', async () => {
  const meera = (await req('/login', { body: { name: 'Meera Iyer', pin: '3146' } })).body;
  const neha = (await req('/login', { body: { name: 'Neha Gupta', pin: '9083' } })).body;
  const v = (await req('/visits', { body: visit({ status: 'followup', followUp: iso(new Date()) }), token: meera.token })).body;
  assert.equal(v.createdBy, meera.user.id);

  // Someone else can't edit or delete it, but can still mark the follow-up done.
  assert.equal((await req('/visits/' + v.id, { method: 'PATCH', body: { notes: 'hijack' }, token: neha.token })).status, 403);
  assert.equal((await req('/visits/' + v.id, { method: 'DELETE', token: neha.token })).status, 403);
  const done = await req('/visits/' + v.id, { method: 'PATCH', body: { status: 'done', followUp: '' }, token: neha.token });
  assert.equal(done.status, 200);
  assert.equal(done.body.notes, '');

  // The person who entered it can edit any field and delete it.
  const e = await req('/visits/' + v.id, { method: 'PATCH', body: { notes: 'Corrected notes', students: '420' }, token: meera.token });
  assert.equal(e.status, 200);
  assert.equal(e.body.notes, 'Corrected notes');
  assert.equal(e.body.students, '420');
  assert.equal((await req('/visits/' + v.id, { method: 'DELETE', token: meera.token })).status, 200);
  assert.equal((await req('/visits/' + v.id, { method: 'DELETE', token: meera.token })).status, 404);

  // Seeded/legacy visits with no recorded author are admin-only.
  const seeded = (await req('/visits', { token: neha.token })).body.find(x => x.id === 'seed-v1');
  assert.equal((await req('/visits/' + seeded.id, { method: 'DELETE', token: neha.token })).status, 403);
  const admin = (await req('/admin/login', { body: { pin: '0000' } })).body.token;
  const mine = (await req('/visits', { body: visit(), token: neha.token })).body;
  assert.equal((await req('/visits/' + mine.id, { method: 'DELETE', token: admin })).status, 200);
});

test('admin can edit any field of a visit', async () => {
  const { token } = (await req('/admin/login', { body: { pin: '0000' } })).body;
  const v = (await req('/visits', { body: visit(), token })).body;
  const u = await req('/visits/' + v.id, { method: 'PATCH', body: { school: 'Renamed School', students: '300', zone: ZONES[5] }, token });
  assert.equal(u.status, 200);
  assert.equal(u.body.school, 'Renamed School');
  assert.equal(u.body.students, '300');
  assert.equal(u.body.metName, 'HM');
});

test('data resets run once and keep members', () => {
  const db = openDb(':memory:');
  seedIfEmpty(db);
  assert.deepEqual(runResets(db), ['2026-10-22-clear-visits']);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM visits').get().n, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM members').get().n, 8);
  seedIfEmpty(db); // members exist, so no reseed
  db.prepare("INSERT INTO visits (id, date, school, location, zone, by_name, met_name, coord_name, status, created_at, updated_at) VALUES ('x', '2026-10-22', 's', 'l', 'z', 'b', 'm', 'c', 'done', '', '')").run();
  assert.deepEqual(runResets(db), []);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM visits').get().n, 1);
});

test('repeated wrong PINs lock the account temporarily', async () => {
  for (let i = 0; i < 5; i++) await req('/login', { body: { name: 'Vikram Das', pin: '0001' } });
  const r = await req('/login', { body: { name: 'Vikram Das', pin: '4419' } });
  assert.equal(r.status, 429);
});

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

test('visits store a GPS location and photos', async () => {
  const { token } = (await req('/login', { body: { name: 'Arjun Rao', pin: '6620' } })).body;
  const created = await req('/visits', { body: visit({ geo: { lat: 8.1833301, lng: 77.4119, acc: 12.4 }, newPhotos: [PNG, PNG] }), token });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.geo, { lat: 8.18333, lng: 77.4119, acc: 12 });
  assert.equal(created.body.photos.length, 2);
  const img = await fetch(base.replace('/api', '') + created.body.photos[0].url);
  assert.equal(img.headers.get('content-type'), 'image/png');
  assert.equal((await img.arrayBuffer()).byteLength, Buffer.from(PNG.split(',')[1], 'base64').length);
  const listed = (await req('/visits', { token })).body.find(v => v.id === created.body.id);
  assert.equal(listed.photos.length, 2);

  // Other members can't remove photos; the admin (or the author) can, and can clear the location.
  const other = (await req('/login', { body: { name: 'Kabir Shah', pin: '5791' } })).body.token;
  assert.equal((await req('/visits/' + created.body.id, { method: 'PATCH', body: { removePhotos: [created.body.photos[0].id] }, token: other })).status, 403);
  const admin = (await req('/admin/login', { body: { pin: '0000' } })).body.token;
  const u = await req('/visits/' + created.body.id, { method: 'PATCH', body: { removePhotos: [created.body.photos[0].id], geo: null }, token: admin });
  assert.equal(u.body.photos.length, 1);
  assert.equal(u.body.geo, null);
  assert.equal((await fetch(base.replace('/api', '') + created.body.photos[0].url)).status, 404);

  // Deleting the visit deletes its photos.
  await req('/visits/' + created.body.id, { method: 'DELETE', token: admin });
  assert.equal((await fetch(base.replace('/api', '') + u.body.photos[0].url)).status, 404);
});

test('bad photos and bad locations are rejected or ignored', async () => {
  const { token } = (await req('/login', { body: { name: 'Arjun Rao', pin: '6620' } })).body;
  assert.equal((await req('/visits', { body: visit({ newPhotos: ['data:text/html;base64,PGI+'] }), token })).status, 400);
  assert.equal((await req('/visits', { body: visit({ newPhotos: [PNG, PNG, PNG, PNG, PNG] }), token })).status, 400);
  const v = await req('/visits', { body: visit({ geo: { lat: 200, lng: 77 } }), token });
  assert.equal(v.body.geo, null);
});

test('a live database from before photos/location upgrades in place', () => {
  const file = path.join(os.tmpdir(), 'fieldbook-upgrade-' + process.pid + '.db');
  fs.rmSync(file, { force: true });
  const old = new DatabaseSync(file);
  old.exec(`CREATE TABLE visits (id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL DEFAULT '', school TEXT NOT NULL, location TEXT NOT NULL, zone TEXT NOT NULL,
    class_counts TEXT NOT NULL DEFAULT '{}', students TEXT NOT NULL DEFAULT '', by_name TEXT NOT NULL, met_name TEXT NOT NULL, met_role TEXT NOT NULL DEFAULT '',
    coord_name TEXT NOT NULL, coord_phone TEXT NOT NULL DEFAULT '', coord_email TEXT NOT NULL DEFAULT '', notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL, follow_up TEXT NOT NULL DEFAULT '', created_by TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    INSERT INTO visits (id, date, school, location, zone, by_name, met_name, coord_name, status, created_at, updated_at) VALUES ('old', '2026-10-22', 's', 'l', 'z', 'b', 'm', 'c', 'done', '', '');`);
  old.close();
  const db = openDb(file);
  const row = db.prepare('SELECT * FROM visits WHERE id = ?').get('old');
  assert.equal(rowToVisit(row).geo, null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM photos').get().n, 0);
  db.close();
  fs.rmSync(file, { force: true });
});
