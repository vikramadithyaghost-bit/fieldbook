import type { Visit } from '../../shared/domain';
import { iso } from '../../shared/domain.js';

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
    ['Date', 'Time', 'School', 'Location', 'Zone', 'Visited by', 'Met with', 'Role', 'Coordinator', 'Phone', 'Email', 'Students', 'Status', 'Follow-up date', 'Notes'],
    list.map(v => [v.date, v.time, v.school, v.location, v.zone, v.by, v.metName, v.metRole, v.coordName, v.coordPhone, v.coordEmail, v.students, v.status === 'followup' ? 'Follow-up' : 'Done', v.followUp, v.notes]));
}

export function schoolsCsv(list: School[]) {
  download('schools',
    ['School', 'Location', 'Zone', 'Students', 'Coordinator', 'Phone', 'Email', 'Visits', 'Last visit', 'Last visited by', 'Members', 'Status', 'Next follow-up'],
    list.map(r => [r.school, r.location, r.zone, r.students, r.coordName, r.coordPhone, r.coordEmail, r.visitCount, r.last.date, r.last.by, r.membersLabel,
      r.status === 'followup' ? 'Follow-up' : 'Done', r.followUp]));
}
