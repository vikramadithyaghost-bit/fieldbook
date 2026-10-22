import express from 'express';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb, seedIfEmpty } from './db.js';
import { createApp } from './app.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = +(process.env.PORT || 3000);
const PROD = process.env.NODE_ENV === 'production';
// The real admin PIN is never stored in the repo: a live server must be given ADMIN_PIN.
const ADMIN_PIN = process.env.ADMIN_PIN || (PROD ? '' : '0000');
// Demo members and visits are for trying the app locally; a live server starts empty unless SEED_DEMO=1.
const SEED = process.env.SEED_DEMO ? process.env.SEED_DEMO === '1' : !PROD;
if (!/^\d{4}$/.test(ADMIN_PIN)) throw new Error('Set ADMIN_PIN to a 4-digit PIN');

const db = openDb(process.env.DB_PATH || path.join(root, 'data', 'fieldbook.db'));
if (SEED && seedIfEmpty(db)) console.log('Seeded demo team and visits');

const app = createApp(db, { adminPin: ADMIN_PIN });
// Behind a hosting proxy (Render, Railway, Fly…) use the real client IP for the PIN lockout.
if (PROD) app.set('trust proxy', 1);

// Serve the built front-end (both the field app and /admin) from the same origin.
const dist = path.join(root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h', setHeaders: (res, p) => { if (p.endsWith('sw.js')) res.setHeader('Cache-Control', 'no-cache'); } }));
  app.get(/^(?!\/api\/).*/, (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.listen(PORT, () => console.log(`Fieldbook running on http://localhost:${PORT}  (field app: /  ·  admin: /admin)`));
