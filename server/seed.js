// Demo data from the Fieldbook design: 8 team members and 14 Kanyakumari-district visits.
import { ZONES, ago } from '../shared/domain.js';

export const SEED_TEAM = ['Asha Verma', 'Rahul Nair', 'Priya Singh', 'Kabir Shah', 'Meera Iyer', 'Arjun Rao', 'Neha Gupta', 'Vikram Das'];
export const SEED_PINS = ['2468', '1357', '8024', '5791', '3146', '6620', '9083', '4419'];

export function seedVisits() {
  const a = ago, T = SEED_TEAM;
  const rows = [
    [0, '10:30', 'Govt. Higher Secondary School, Vadasery', 'Vadasery, Nagercoil', 1, 840, T[0], 'Mrs. Kavitha R.', 'Headmistress', 'Mr. Suresh Kumar', '+91 98110 22341', 'suresh.k@ghssvadasery.edu', 'Demoed the reading kit to Class 4 teachers. HM keen to pilot in two sections from November.', 'followup', a(-7)],
    [0, '09:15', "St. Xavier's Primary School", 'Kottar, Nagercoil', 1, 520, T[1], 'Fr. Thomas', 'Headmaster', 'Ms. Ritu Jebaraj', '+91 94140 55120', 'ritu.j@sxp.org', 'Signed MoU. Kits to be delivered by 2 Nov.', 'done', ''],
    [1, '14:00', 'Govt. High School, Thovalai', 'Thovalai', 2, 610, T[2], 'Mr. Anil Joseph', 'Assistant HM', 'Mr. Anil Joseph', '+91 98220 11873', 'anil.j@ghsthovalai.in', 'Teacher training scheduled for Saturday. Need projector confirmation.', 'followup', a(-3)],
    [1, '11:20', 'Sunrise Matriculation School', 'Aralvaimozhi', 2, 650, T[3], 'Ms. Deepa Kumari', 'Coordinator', 'Ms. Deepa Kumari', '+91 99000 43210', 'deepa@sunrise.edu.in', 'Baseline assessment completed for 3 classes.', 'done', ''],
    [2, '10:00', 'Panchayat Union Primary School', 'Thuckalay', 3, 310, T[2], 'Mr. Ganesan P.', 'Head Teacher', 'Mrs. Sunitha M.', '+91 97650 88213', '', 'Low attendance this week. Revisit after Deepavali.', 'followup', a(2)],
    [3, '12:45', 'Infant Jesus Hr. Sec. School', 'Mulagumoodu, Thuckalay', 3, 2100, T[0], 'Dr. Neela S.', 'Principal', 'Mr. Rohan Raj', '+91 98100 77651', 'r.raj@ijhss.edu', 'Shared impact report; management review pending.', 'followup', a(-5)],
    [4, '09:40', 'Govt. Girls Hr. Sec. School', 'Marthandam', 4, 980, T[4], 'Mrs. Usha B.', 'Headmistress', 'Ms. Pooja Anand', '+91 98731 66420', 'pooja.a@ggsss.in', 'Library corner set up. Photos shared on group.', 'done', ''],
    [5, '15:10', 'Holy Cross Convent School', 'Kuzhithurai, Marthandam', 4, 760, T[5], 'Sr. Maria', 'Principal', "Mr. Ivan D'Cruz", '+91 98200 31457', 'ivan@holycross.edu', 'Introductory meeting. Sent brochure and pricing.', 'done', ''],
    [6, '11:00', 'Govt. High School, Kulasekaram', 'Kulasekaram', 5, 540, T[6], 'Mr. Subramanian G.', 'Headmaster', 'Mr. Subramanian G.', '+91 94330 12598', 'subbu@ghskulasekaram.in', 'Completed term-1 review. Scores up 12% vs baseline.', 'done', ''],
    [8, '10:15', 'Little Flower Matric School', 'Thiruvattar, Kulasekaram', 5, 430, T[3], 'Ms. Lakshmi Iyer', 'Academic Head', 'Ms. Lakshmi Iyer', '+91 98410 20984', 'lakshmi@lfs.edu.in', 'Requested Tamil-medium materials.', 'followup', a(-2)],
    [10, '13:30', 'Govt. Hr. Sec. School, Kanyakumari', 'Kanyakumari', 6, 690, T[7], 'Mr. Ramesh R.', 'Headmaster', 'Mrs. Swathi R.', '+91 99490 61732', '', 'Monitoring visit. All sections on schedule.', 'done', ''],
    [13, '10:50', "St. Antony's Hr. Sec. School", 'Agastheeswaram, Kanyakumari', 6, 1500, T[4], 'Mr. Sharma', 'Principal', 'Ms. Anjali V.', '+91 98110 90012', 'anjali.v@stantonys.edu', 'Renewal discussion for next academic year.', 'done', ''],
    [16, '09:30', 'Sacred Heart School', 'Colachel, Thuckalay', 3, 820, T[1], 'Sr. Annie', 'Principal', 'Mr. Joseph K.', '+91 94470 55618', 'joseph@shscolachel.in', 'Teacher feedback session. Collected 24 forms.', 'done', ''],
    [21, '14:20', 'Panchayat Union Middle School', 'Suchindram, Thovalai', 2, 460, T[5], 'Mrs. Shaila', 'Head Teacher', 'Mr. Salim S.', '+91 98920 40871', '', 'Space constraints; proposed after-school slot.', 'done', '']
  ];
  return rows.map((r, i) => ({
    id: 'seed-v' + (i + 1), date: a(r[0]), time: r[1], school: r[2], location: r[3], zone: ZONES[r[4] - 1], students: String(r[5]),
    by: r[6], metName: r[7], metRole: r[8], coordName: r[9], coordPhone: r[10], coordEmail: r[11], notes: r[12], status: r[13], followUp: r[14]
  }));
}
