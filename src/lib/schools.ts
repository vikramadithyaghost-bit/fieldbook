import type { Visit } from '../../shared/domain';
import type { Geo } from '../../shared/domain';
import { iso } from '../../shared/domain.js';
import { mapsUrl } from './media';

const geoCols = (g?: Geo | null) => (g ? [g.lat, g.lng, mapsUrl(g)] : ['', '', '']);

export interface School {
  key: string;
  visits: Visit[];
  last: Visit;
  school: string;
  location: string;
  zone: string;
  students: string;
  coordName: string;
  coordPhone: string;
  coordEmail: string;
  visitCount: number;
  members: string[];
  membersLabel: string;
  status: Visit['status'];
  followUp: string;
}

const byNewest = (a: Visit, b: Visit) => (b.date + b.time).localeCompare(a.date + a.time);

/** One row per school (matched on name), built from all its visits. The latest visit decides status. */
export function groupSchools(visits: Visit[]): School[] {
  const byKey = new Map<string, Visit[]>();
  visits.forEach(v => {
    const k = v.school.trim().toLowerCase();
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(v);
  });
  return [...byKey.entries()].map(([key, list]) => {
    const vs = [...list].sort(byNewest);
    const L = vs[0];
    const pick = (f: keyof Visit) => String((vs.find(v => v[f]) || {} as Visit)[f] || '');
    const members = [...new Set(vs.map(v => v.by))];
    return {
      key, visits: vs, last: L, school: L.school, location: L.location, zone: L.zone || '',
      students: pick('students'), coordName: pick('coordName'), coordPhone: pick('coordPhone'), coordEmail: pick('coordEmail'),
      visitCount: vs.length, members, membersLabel: members.map(m => m.split(' ')[0]).join(', '),
      status: L.status, followUp: L.status === 'followup' ? L.followUp : ''
    };
  });
}

function download(name: string, header: string[], rows: unknown[][]) {
  const q = (x: unknown) => '"' + String(x ?? '').replace(/"/g, '""') + '"';
  const body = [header.map(q).join(','), ...rows.map(r => r.map(q).join(','))].join('\n');
  const blob = new Blob(['﻿' + body], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '-' + iso(new Date()) + '.csv';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function visitsCsv(list: Visit[]) {
  download('school-visits',
    ['Date', 'Time', 'School', 'Location', 'Zone', 'Visited by', 'Met with', 'Role', 'Coordinator', 'Phone', 'Email', 'Students', 'Status', 'Follow-up date', 'Notes', 'Latitude', 'Longitude', 'Map link', 'Photos'],
    list.map(v => [v.date, v.time, v.school, v.location, v.zone, v.by, v.metName, v.metRole, v.coordName, v.coordPhone, v.coordEmail, v.students, v.status === 'followup' ? 'Follow-up' : 'Done', v.followUp, v.notes,
      v.geo?.lat ?? '', v.geo?.lng ?? '', v.geo ? mapsUrl(v.geo) : '', (v.photos || []).length]));
}

export function schoolsCsv(list: School[]) {
  download('schools',
    ['School', 'Location', 'Zone', 'Students', 'Coordinator', 'Phone', 'Email', 'Visits', 'Last visit', 'Last visited by', 'Members', 'Status', 'Next follow-up', 'Latitude', 'Longitude', 'Map link', 'Photos'],
    list.map(r => [r.school, r.location, r.zone, r.students, r.coordName, r.coordPhone, r.coordEmail, r.visitCount, r.last.date, r.last.by, r.membersLabel,
      r.status === 'followup' ? 'Follow-up' : 'Done', r.followUp, ...geoCols(r.visits.find(v => v.geo)?.geo), r.visits.reduce((n, v) => n + (v.photos || []).length, 0)]));
}

// --- Excel (.xlsx) export. The writer is loaded only when someone exports.
type XCell = import('./xlsx').Cell;
const yesNo = (s: Visit['status']) => (s === 'followup' ? 'Follow-up' : 'Done');
const mapCell = (g?: Geo | null): XCell => (g ? { link: mapsUrl(g), text: 'Open map' } : '');
const photoCells = (v: Visit): XCell[] => [0, 1, 2, 3].map(i => v.photos?.[i] ? { link: location.origin + v.photos[i].url, text: 'Photo ' + (i + 1) } : '');
const num = (s: string) => (s && /^\d+$/.test(s) ? +s : s);

const VISIT_COLS = [
  ['Date', 12], ['Time', 8], ['School', 34], ['Location', 22], ['Zone', 22], ['Visited by', 16], ['Met with', 20], ['Role', 16], ['Coordinator', 20],
  ['Phone', 16], ['Email', 26], ['Students', 10], ['Status', 11], ['Follow-up date', 14], ['Notes', 50], ['Latitude', 11], ['Longitude', 11], ['Map', 11],
  ['Photo 1', 9], ['Photo 2', 9], ['Photo 3', 9], ['Photo 4', 9]
] as const;

const visitRow = (v: Visit): XCell[] => [
  { date: v.date }, v.time, v.school, v.location, v.zone, v.by, v.metName, v.metRole, v.coordName, v.coordPhone, v.coordEmail, num(v.students),
  yesNo(v.status), v.followUp ? { date: v.followUp } : '', v.notes, v.geo?.lat, v.geo?.lng, mapCell(v.geo), ...photoCells(v)
];

async function downloadXlsx(name: string, sheets: import('./xlsx').Sheet[]) {
  const { buildXlsx } = await import('./xlsx');
  const blob = new Blob([buildXlsx(sheets) as Uint8Array<ArrayBuffer>], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name + '-' + iso(new Date()) + '.xlsx';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

const visitsSheet = (list: Visit[]) => ({ name: 'Visits', columns: VISIT_COLS.map(([header, width]) => ({ header, width })), rows: list.map(visitRow) });

export function visitsXlsx(list: Visit[]) {
  return downloadXlsx('school-visits', [visitsSheet(list)]);
}

export function schoolsXlsx(list: School[]) {
  const cols = [['School', 34], ['Location', 22], ['Zone', 22], ['Students', 10], ['Coordinator', 20], ['Phone', 16], ['Email', 26], ['Visits', 8],
    ['Last visit', 12], ['Last visited by', 16], ['Visited by', 24], ['Status', 11], ['Next follow-up', 14], ['Latitude', 11], ['Longitude', 11], ['Map', 11], ['Photos', 8]] as const;
  const schools = {
    name: 'Schools', columns: cols.map(([header, width]) => ({ header, width })),
    rows: list.map(r => {
      const g = r.visits.find(v => v.geo)?.geo;
      return [r.school, r.location, r.zone, num(r.students), r.coordName, r.coordPhone, r.coordEmail, r.visitCount, { date: r.last.date }, r.last.by,
        r.members.join(', '), yesNo(r.status), r.followUp ? { date: r.followUp } : '', g?.lat, g?.lng, mapCell(g), r.visits.reduce((n, v) => n + (v.photos || []).length, 0)] as XCell[];
    })
  };
  const visits = list.flatMap(r => r.visits).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time));
  return downloadXlsx('schools', [schools, visitsSheet(visits)]);
}
