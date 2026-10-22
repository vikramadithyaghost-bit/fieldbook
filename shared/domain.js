// Domain constants and date helpers shared by the server and both front-ends.

export const ZONES = ['Zone 1 — Nagercoil', 'Zone 2 — Thovalai', 'Zone 3 — Thuckalay', 'Zone 4 — Marthandam', 'Zone 5 — Kulasekaram', 'Zone 6 — Kanyakumari'];
export const CLASSES = ['LKG', 'UKG', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

export const classLabel = c => (/^\d/.test(c) ? 'Class ' + c : c);
export const zoneShort = z => (z || '—').split(' — ')[0];
export const zonePlace = z => (z || '').split(' — ')[1] || '';

export function iso(d) {
  const z = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate());
}
export function ago(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return iso(d);
}
/** Whole days from `isoDate` to today (positive = in the past). */
export function daysFrom(isoDate) {
  return Math.round((new Date(iso(new Date()) + 'T00:00') - new Date(isoDate + 'T00:00')) / 864e5);
}
export function inPeriod(v, p) {
  if (p === 'all') return true;
  const n = daysFrom(v.date);
  if (p === 'today') return n === 0;
  if (p === 'week') return n >= 0 && n < 7;
  const d = new Date(v.date + 'T00:00'), now = new Date();
  return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
}
export function dLabel(isoDate, long) {
  if (!isoDate) return '';
  const n = daysFrom(isoDate);
  if (n === 0) return 'Today';
  if (n === 1) return 'Yesterday';
  if (n === -1) return 'Tomorrow';
  return new Date(isoDate + 'T00:00').toLocaleDateString('en-GB', long ? { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' } : { day: 'numeric', month: 'short' });
}
export function initials(n) {
  return String(n || '').replace(/^(Mr|Mrs|Ms|Dr|Fr|Sr|Col)\.?\s*/i, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}
export const fmtNum = n => Number(n || 0).toLocaleString('en-IN');

/** Field validation for one step of the New visit form (or all steps when step is omitted). */
export function validateVisit(d, step) {
  const e = {}, all = step === undefined;
  if (all || step === 0) {
    if (!d.school?.trim()) e.school = 'Enter the school name';
    if (!d.location?.trim()) e.location = 'Enter a location';
    if (!ZONES.includes(d.zone)) e.zone = 'Select a zone';
  }
  if (all || step === 1) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || '')) e.date = 'Pick the visit date';
    if (!d.by?.trim()) e.by = 'Who made the visit?';
  }
  if (all || step === 2) {
    if (!d.metName?.trim()) e.metName = 'Who did you meet?';
    if (!d.coordName?.trim()) e.coordName = 'Add the coordinating person';
    if (d.coordPhone && d.coordPhone.replace(/\D/g, '').length < 10) e.coordPhone = 'Phone looks too short';
    if (d.coordEmail && !/^\S+@\S+\.\S+$/.test(d.coordEmail)) e.coordEmail = 'Check the email address';
  }
  if (all || step === 3) {
    if (d.status !== 'done' && d.status !== 'followup') e.status = 'Pick a status';
    if (d.status === 'followup' && !d.followUp) e.followUp = 'Pick a follow-up date';
  }
  return e;
}
