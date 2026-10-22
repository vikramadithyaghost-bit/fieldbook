import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { openDb, seedIfEmpty } from './db.js';
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
const visit = (over = {}) => ({ id: 'v-test-' + Math.random(), school: 'Test School', location: 'Nagercoil', zone: ZONES[0], date: iso(new Date()), time: '10:00', by: 'Asha Verma', metName: 'HM', coordName: 'Coord', status: 'done', classCounts: { LKG: '20', '1': '30' }, ...over });

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

test('visits need auth; create is idempotent and totals class counts', async () => {
  assert.equal((await req('/visits')).status, 401);
  const { token } = (await req('/login', { body: { name: 'Rahul Nair', pin: '1357' } })).body;
  const v = visit();
  const a = await req('/visits', { body: v, token });
  assert.equal(a.status, 201);
  assert.equal(a.body.students, '50');
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

test('repeated wrong PINs lock the account temporarily', async () => {
  for (let i = 0; i < 5; i++) await req('/login', { body: { name: 'Vikram Das', pin: '0001' } });
  const r = await req('/login', { body: { name: 'Vikram Das', pin: '4419' } });
  assert.equal(r.status, 429);
});
