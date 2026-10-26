import { statusLabel } from '../shared/domain.js';

// Activity log: one row per thing someone did. Never stores PINs or photo data.
export function initActivity(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS activity (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      at TEXT NOT NULL,
      actor_role TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      target_id TEXT,
      target_label TEXT,
      details TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS activity_at ON activity(at);
  `);
}

/** Who did it: a signed-in session, or { role, id, name } for sign-in attempts. */
export function logActivity(db, who, action, target, details) {
  target = target || {};
  details = details || {};
  const role = who.role || 'unknown';
  const name = role === 'admin' ? 'Admin' : who.name || 'Unknown';
  db.prepare('INSERT INTO activity (at, actor_role, actor_id, actor_name, action, target_id, target_label, details) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(new Date().toISOString(), role, who.memberId ?? who.id ?? null, name, action, target.id ?? null, target.label ?? null, JSON.stringify(details));
}

const FIELDS = {
  school: 'School', location: 'Location', zone: 'Zone', students: 'Students', date: 'Visit date', time: 'Time', by: 'Visited by',
  metName: 'Met with', metRole: 'Role', coordName: 'Coordinator', coordPhone: 'Phone', coordEmail: 'Email',
  status: 'Status', followUp: 'Follow-up date', notes: 'Notes', geo: 'Location pin'
};
const show = (k, v) => {
  if (k === 'status') return statusLabel(v);
  if (k === 'geo') return v ? `${v.lat}, ${v.lng}` : '';
  const s = String(v ?? '');
  return s.length > 300 ? s.slice(0, 300) + '…' : s;
};

/** Field-by-field differences between two versions of a visit, with readable labels and values. */
export function visitChanges(before, after) {
  return Object.keys(FIELDS)
    .filter(k => show(k, before[k]) !== show(k, after[k]))
    .map(k => ({ field: FIELDS[k], from: show(k, before[k]), to: show(k, after[k]) }));
}

const TYPES = {
  visits: "action LIKE 'visit.%'",
  signins: "(action LIKE 'signin%' OR action LIKE 'admin.signin%' OR action = 'signout')",
  members: "action LIKE 'member.%'",
  exports: "action = 'export'"
};

/** Newest first, paged by id. Filters: actor (member id or "admin"), type (see TYPES) and free-text q. */
export function listActivity(db, { before, limit = 50, actor, type, q } = {}) {
  const where = [], args = [];
  if (before) { where.push('id < ?'); args.push(+before); }
  if (actor === 'admin') where.push("actor_role = 'admin'");
  else if (actor) { where.push('actor_id = ?'); args.push(actor); }
  if (type && TYPES[type]) where.push(TYPES[type]);
  if (q) { where.push('(actor_name LIKE ? OR target_label LIKE ? OR details LIKE ?)'); const like = '%' + q + '%'; args.push(like, like, like); }
  const n = Math.min(Math.max(+limit || 50, 1), 200);
  const rows = db.prepare(`SELECT * FROM activity ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`).all(...args, n + 1);
  const items = rows.slice(0, n).map(r => ({
    id: r.id, at: r.at, actor: { role: r.actor_role, id: r.actor_id, name: r.actor_name }, action: r.action,
    target: r.target_id || r.target_label ? { id: r.target_id, label: r.target_label } : null, details: JSON.parse(r.details || '{}')
  }));
  return { items, more: rows.length > n, before: items.length ? items[items.length - 1].id : null };
}
