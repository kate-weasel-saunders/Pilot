import type { CheckIn, HealthSampleRow, MeasureKey, Period } from '../data/types';
import { addDays } from './time';
import { periodEndKey, periodStartKey } from './periods';
import { indexByDay, summarise } from './healthDaily';

/**
 * Data for the Trends charts. Pure: dates are local YYYY-MM-DD strings, so
 * days line up with how check-ins and periods are recorded.
 */

export type RangePreset = '7' | '30' | '90' | 'custom';

export interface Range {
  from: string;
  to: string; // inclusive
}

export function presetRange(preset: Exclude<RangePreset, 'custom'>, today: string): Range {
  return { from: addDays(today, -(Number(preset) - 1)), to: today };
}

/** Every date in the range, oldest first. */
export function daysIn(r: Range): string[] {
  const out: string[] = [];
  for (let d = r.from; d <= r.to && out.length < 3700; d = addDays(d, 1)) out.push(d);
  return out;
}

export interface Point {
  date: string;
  value: number;
}

export interface CheckInPoint extends Point {
  id: string;
  time: string;
}

export interface MeasureSeries {
  /** Every check-in's value (dots). */
  points: CheckInPoint[];
  /** Daily average (line), only for days with data. */
  daily: (Point & { n: number })[];
}

export function measureSeries(checkIns: CheckIn[], key: MeasureKey, r: Range): MeasureSeries {
  const points: CheckInPoint[] = [];
  const byDay = new Map<string, number[]>();
  for (const c of checkIns) {
    const v = c[key];
    if (v == null || c.local_date < r.from || c.local_date > r.to) continue;
    points.push({ id: c.id, date: c.local_date, time: c.local_time.slice(0, 5), value: v });
    byDay.set(c.local_date, [...(byDay.get(c.local_date) ?? []), v]);
  }
  points.sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  const daily = [...byDay.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, vs]) => ({ date, value: vs.reduce((x, y) => x + y, 0) / vs.length, n: vs.length }));
  return { points, daily };
}

/**
 * Split a daily line into segments wherever there's a gap of more than
 * `maxGapDays`, so the chart never draws a line across days with no data.
 */
export function segments<T extends Point>(daily: T[], maxGapDays = 2): T[][] {
  const out: T[][] = [];
  for (const p of daily) {
    const last = out.at(-1)?.at(-1);
    const gap = last ? Math.round((Date.parse(`${p.date}T12:00:00Z`) - Date.parse(`${last.date}T12:00:00Z`)) / 86400000) : 0;
    if (!last || gap > maxGapDays) out.push([p]);
    else out.at(-1)!.push(p);
  }
  return out;
}

export interface HealthDaily {
  sleepHours: Point[]; // by wake date
  hrv: Point[];
}

export function healthSeries(samples: HealthSampleRow[], r: Range, timeZone: string): HealthDaily {
  const byDay = indexByDay(samples, timeZone);
  const sleepHours: Point[] = [];
  const hrv: Point[] = [];
  for (const date of daysIn(r)) {
    const d = summarise(byDay.get(date));
    if (d?.sleepMin != null) sleepHours.push({ date, value: Math.round((d.sleepMin / 60) * 10) / 10 });
    if (d?.hrv != null) hrv.push({ date, value: Math.round(d.hrv) });
  }
  return { sleepHours, hrv };
}

export interface Band {
  id: string;
  title: string;
  from: string; // clipped to the range
  to: string;
}

/** Periods overlapping the range, clipped to it (whole days). */
export function periodBands(periods: Period[], r: Range): Band[] {
  return periods
    .map((p) => ({ p, from: periodStartKey(p).slice(0, 10), to: (periodEndKey(p) ?? `${r.to}T23:59:59`).slice(0, 10) }))
    .filter(({ from, to }) => to >= r.from && from <= r.to)
    .map(({ p, from, to }) => ({ id: p.id, title: p.title, from: from < r.from ? r.from : from, to: to > r.to ? r.to : to }))
    .sort((a, b) => a.from.localeCompare(b.from));
}
