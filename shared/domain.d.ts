export type Status = 'done' | 'followup';
export type Period = 'today' | 'week' | 'month' | 'all';

export interface Visit {
  id: string;
  date: string;
  time: string;
  school: string;
  location: string;
  zone: string;
  classCounts: Record<string, string>;
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
  pending?: boolean;
}

export interface Member {
  id: string;
  name: string;
  pin?: string;
  added?: string;
}

export const ZONES: string[];
export const CLASSES: string[];
export function classLabel(c: string): string;
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
