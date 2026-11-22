import type { HealthSampleRow } from '../data/types';
import { wallClock } from './time';

/**
 * One day's health at a glance, for day cards and Today.
 * - sleep: the longest session that ENDED on this date (the night before it)
 * - hrv: mean of the day's readings; restingHr: the day's value (mean if several)
 * - active: every exercise minute that day (matches the Watch's Exercise ring),
 *   from raw readings; falls back to active periods if there are none
 * - mindful: total minutes starting on this date
 * Fields are null when there's no data (shown as no tag, never as zero).
 */
export interface DayHealth {
  sleepMin: number | null;
  hrv: number | null;
  restingHr: number | null;
  activeMin: number | null;
  mindfulMin: number | null;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const sum = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) : null);

/** Group samples by the local date relevant to each (wake date for sleep, start date otherwise). */
export function indexByDay(samples: HealthSampleRow[], timeZone: string): Map<string, HealthSampleRow[]> {
  const map = new Map<string, HealthSampleRow[]>();
  for (const s of samples) {
    const date = wallClock(new Date(s.metric === 'sleep' ? s.ends_at : s.starts_at), timeZone).date;
    const list = map.get(date);
    if (list) list.push(s);
    else map.set(date, [s]);
  }
  return map;
}

function coveredMinutes(rows: HealthSampleRow[]): number {
  const spans = rows.map((r) => [Date.parse(r.starts_at), Date.parse(r.ends_at)] as const).sort((a, b) => a[0] - b[0]);
  let total = 0;
  let cur: [number, number] | null = null;
  for (const [s, e] of spans) {
    if (!cur || s > cur[1]) {
      if (cur) total += cur[1] - cur[0];
      cur = [s, e];
    } else cur[1] = Math.max(cur[1], e);
  }
  if (cur) total += cur[1] - cur[0];
  return total / 60000;
}

export function summarise(day: HealthSampleRow[] | undefined): DayHealth | null {
  if (!day?.length) return null;
  const of = (m: HealthSampleRow['metric']) => day.filter((s) => s.metric === m && s.value !== null).map((s) => Number(s.value));
  const sleeps = of('sleep');
  const raw = day.filter((s) => s.metric === 'active_minutes' && s.value !== null);
  // Overlapping readings from two sources shouldn't count twice: cap at the covered time.
  const rawTotal = raw.length ? Math.min(sum(raw.map((s) => Number(s.value)))!, coveredMinutes(raw)) : null;
  const r: DayHealth = {
    sleepMin: sleeps.length ? Math.max(...sleeps) : null,
    hrv: mean(of('hrv')),
    restingHr: mean(of('resting_hr')),
    activeMin: rawTotal !== null ? Math.round(rawTotal) : sum(of('workout')),
    mindfulMin: sum(of('mindful')),
  };
  return Object.values(r).some((v) => v !== null) ? r : null;
}
