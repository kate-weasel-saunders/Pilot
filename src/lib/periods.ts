import type { CheckIn, Period } from '../data/types';

/**
 * Period membership. Periods use floating wall-clock bounds, compared with a
 * check-in's local date/time, so they mean the same thing in any time zone.
 * Comparison is on "YYYY-MM-DDTHH:MM:SS" strings, which sort chronologically.
 */

const pad = (t: string) => (t.length === 5 ? `${t}:00` : t.slice(0, 8));

export function periodStartKey(p: Pick<Period, 'start_date' | 'start_time'>): string {
  return `${p.start_date}T${pad(p.start_time ?? '00:00:00')}`;
}

/** Inclusive end, or null when ongoing. */
export function periodEndKey(p: Pick<Period, 'end_date' | 'end_time'>): string | null {
  if (!p.end_date) return null;
  return `${p.end_date}T${pad(p.end_time ?? '23:59:59')}`;
}

export function wallKey(localDate: string, localTime: string): string {
  return `${localDate}T${pad(localTime)}`;
}

export function containsWallClock(p: Period, localDate: string, localTime: string): boolean {
  const k = wallKey(localDate, localTime);
  const end = periodEndKey(p);
  return k >= periodStartKey(p) && (end === null || k <= end);
}

export function periodsFor(c: Pick<CheckIn, 'local_date' | 'local_time'>, periods: Period[]): Period[] {
  return periods.filter((p) => containsWallClock(p, c.local_date, c.local_time));
}

export type PeriodStatus = 'active' | 'upcoming' | 'past';

export function periodStatus(p: Period, nowDate: string, nowTime: string): PeriodStatus {
  const k = wallKey(nowDate, nowTime);
  if (k < periodStartKey(p)) return 'upcoming';
  const end = periodEndKey(p);
  if (end !== null && k > end) return 'past';
  return 'active';
}

/** Human description of a period's span, e.g. "30 Nov – 14 Dec 2026". */
export function describeSpan(p: Period, fmt: (d: string) => string): string {
  const start = fmt(p.start_date) + (p.start_time ? ` ${p.start_time.slice(0, 5)}` : '');
  if (!p.end_date) return `From ${start} · ongoing`;
  const end = fmt(p.end_date) + (p.end_time ? ` ${p.end_time.slice(0, 5)}` : '');
  return `${start} – ${end}`;
}
