export type Status = 'done' | 'followup' | 'notinterested';
export type Period = 'today' | 'week' | 'month' | 'all';

export interface Geo { lat: number; lng: number; acc: number }
export interface Photo { id: string; url: string }

export interface Visit {
  id: string;
  date: string;
  time: string;
  school: string;
  location: string;
  zone: string;
  students: string;
  by: string;
  metName: string;
  metRole: string;
  coordName: string;
  coordPhone: string;
  coordEmail: string;
  notes: string;
  status: Status;
  followUp: string;
  geo?: Geo | null;
  photos?: Photo[];
  /** Data-URL photos waiting to upload with this visit. */
  newPhotos?: string[];
  /** Member id of whoever entered the visit (null for older or admin-entered visits). */
  createdBy?: string | null;
  pending?: boolean;
}

export interface Member {
  id: string;
  name: string;
  pin?: string;
  added?: string;
}

export const ZONES: string[];
export const STATUSES: Status[];
export function statusLabel(s: Status): string;
export function zoneShort(z: string | undefined): string;
export function zonePlace(z: string | undefined): string;
export function iso(d: Date): string;
export function ago(n: number): string;
export function daysFrom(iso: string): number;
export function inPeriod(v: { date: string }, p: Period): boolean;
export function dLabel(iso: string | undefined, long?: boolean): string;
export function initials(n: string): string;
export function fmtNum(n: string | number | undefined): string;
export function validateVisit(d: Partial<Visit>, step?: number): Record<string, string>;
