# Fieldbook

School-visit logging for a field team in Kanyakumari district, plus a web dashboard for the admin. One server provides both:

| URL | Who | What |
| --- | --- | --- |
| `/` | Field team (phones) | Sign in with name + PIN, log visits in four steps, browse all team visits, edit or delete your own, per-member stats. Works offline. |
| `/admin` | Admin (desktop) | Overview (KPIs, visits by zone, team, follow-ups due), Schools (paged, sortable table, detail drawer with edit/delete, Excel and CSV export), Members (add, PIN reset, remove). |

The original Claude Design prototypes and the design chat are kept in `project/` and `chats/` for reference.

## Run it

Requires **Node 22.13+**. The app uses the built-in `node:sqlite`, so there are no native modules to compile.

```bash
npm install
npm run build      # type-checks and builds the front-end into dist/
npm start          # http://localhost:3000  (field app)  ·  /admin (dashboard)
```

For development, `npm run dev` runs the API on :3000 and Vite on :5173 with hot reload. Open http://localhost:5173 and http://localhost:5173/admin.

`npm test` runs the API tests.

### Configuration (environment variables)

| Variable | Default | |
| --- | --- | --- |
| `PORT` | `3000` | |
| `ADMIN_PIN` | `0000` locally; **required** when `NODE_ENV=production` | 4-digit admin PIN for `/admin`. Set it on the host, never in the code. |
| `DB_PATH` | `data/fieldbook.db` | SQLite file. Back this file up. |
| `SEED_DEMO` | on locally, off when `NODE_ENV=production` | Loads 8 demo members and 14 demo visits into an empty database. A live server starts empty; add your real team under Members. |

Locally: admin PIN `0000`; demo field login **Asha Verma · 2468**.

## How it works

- **Shared data:** every visit and member is stored in SQLite on the server, so everyone sees the whole team's visits.
- **Offline:** the field app caches visits on the phone, and new visits or "Mark follow-up done" go into an on-device queue. The queue uploads when the connection returns (also every minute, and when you tap the sync pill). Uploads are idempotent, so retries never create duplicate visits. A service worker keeps the app shell available with no signal. Phones can install the app from the browser menu ("Add to Home screen").
- **Sign-in:** members choose their name and enter the 4-digit PIN the admin generated. After 5 wrong PINs, that name is locked for 5 minutes. A PIN reset or removal signs that member out everywhere. Removed members keep their past visits.
- **Location and photos:** on the first step of New visit, "Use my current location" saves the phone's GPS position (no mobile data needed; HTTPS and location permission required), and up to 4 photos can be taken or picked from the gallery. Photos are shrunk on the phone (≈100 KB each), queue offline with the visit, and are stored in the database. The admin sees a Google Maps link and the photos, and can remove either when editing a visit.
- **Excel export:** on Schools, **Export Excel** downloads an `.xlsx` with a *Schools* sheet (one row per school, following the current search and filters) and a *Visits* sheet (every visit for those schools). Dates are real Excel dates, numbers are numbers, and map/photo cells are clickable links; the header row is frozen with filters. On Overview it exports the filtered visits. **CSV** is still available next to it.
- **Visit outcome:** each visit ends as **Done**, **Follow-up needed** (with a date) or **Not interested** (the school declined; the notes box asks for the reason). Not interested shows as a grey badge, can be filtered on the phone and in Schools, is counted on Overview and Schools, and is included in exports. Databases from before this status existed are upgraded in place on first start, keeping every visit and photo.
- **Editing your own visits:** on the phone, a visit you entered shows **Edit visit** and **Delete**. Editing reopens the four-step form with everything filled in (photos can be removed or added). Both work offline and sync later. Teammates' visits can't be edited or deleted, though anyone can still mark a follow-up done; the server enforces this.
- **Admin edits:** in Schools, open a school to view, edit or delete any visit, or delete the school with all its visits. Deletes ask for confirmation and can't be undone.
- **Data resets:** `RESETS` in `server/db.js` lists one-off clean-ups that run once on the next start (the first clears all test visits before go-live, keeping team members).

## Deploying

**Render (recommended):** push this repo to GitHub, then in Render choose **New → Blueprint** and pick the repo. Render asks for `ADMIN_PIN`; enter your admin PIN. `render.yaml` sets up the service, HTTPS and a 1 GB persistent disk for the database (Starter plan, needed for the disk). The site is live at `https://fieldbook-xxxx.onrender.com`; the field app is `/` and the dashboard is `/admin`.

**Anywhere else:** the `Dockerfile` runs on Railway, Fly.io or any VM. Mount a persistent volume at `/data` (the database lives there) and serve it over HTTPS: phones need HTTPS for offline use and home-screen install.

## Project layout

```
server/      Express API (app.js), SQLite schema (db.js), demo seed, tests
shared/      Zones, classes, date helpers and validation shared by the server and the UI
src/field/   Mobile field app and its offline store
src/admin/   Admin web dashboard
src/styles/  Design tokens and styles from the Fieldbook design
```
