import { iso } from '../../shared/domain.js';

/** "Today, 10:42", "Yesterday, 18:05" or "26 Oct 2026, 10:42" in the viewer's time zone. */
export function stamp(at: string | null | undefined, seconds = false): string {
  if (!at) return '';
  const d = new Date(at);
  if (isNaN(+d)) return '';
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', ...(seconds ? { second: '2-digit' } : {}) });
  const day = iso(d), today = iso(new Date()), y = new Date(); y.setDate(y.getDate() - 1);
  if (day === today) return 'Today, ' + time;
  if (day === iso(y)) return 'Yesterday, ' + time;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ', ' + time;
}

/** Full timestamp for tooltips, e.g. "Mon 26 Oct 2026, 10:42:15". */
export const exact = (at: string | null | undefined) => (at ? new Date(at).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '');

/** True when a visit was changed after it was entered (allowing for the same-second write on create). */
export const wasUpdated = (v: { createdAt?: string | null; updatedAt?: string | null }) =>
  !!v.createdAt && !!v.updatedAt && Date.parse(v.updatedAt) - Date.parse(v.createdAt) > 1000;

/** Local "YYYY-MM-DD HH:MM" for CSV. */
export const csvStamp = (at: string | null | undefined) => {
  if (!at) return '';
  const d = new Date(at), z = (n: number) => String(n).padStart(2, '0');
  return `${iso(d)} ${z(d.getHours())}:${z(d.getMinutes())}`;
};
