/**
 * Apple Health lines (sent by an iOS Shortcut) → health samples. Pure, so it
 * runs in the Edge Function (Deno) and in unit tests (Node) unchanged.
 *
 * One reading per line, fields separated by "|":
 *
 *   metric | start | end | value | unit | label
 *
 *   workout   | 2026-11-21T07:10:00Z | 2026-11-21T07:45:00Z |      |     | Running
 *   mindful   | 2026-11-21T08:00:00Z | 2026-11-21T08:10:00Z
 *   sleep     | 2026-11-20T23:10:00Z | 2026-11-21T00:40:00Z | Core
 *   hrv       | 2026-11-21T03:00:00Z | 2026-11-21T03:01:00Z | 48.2 | ms
 *   resting_hr| 2026-11-21T00:00:00Z | 2026-11-21T23:59:00Z | 58   | count/min
 *
 * Forgiving about wording ("Heart Rate Variability", "Mindful Minutes"),
 * decimal commas and units glued to numbers. Strict about dates: ISO 8601 with
 * a time zone, because a date without one can't be placed in time.
 * Sleep stage samples are condensed into one summary per night.
 */

export type Metric = 'workout' | 'mindful' | 'sleep' | 'hrv' | 'resting_hr';

export interface HealthSample {
  metric: Metric;
  starts_at: string;
  ends_at: string;
  value: number | null;
  unit: string | null;
  label: string | null;
  detail: Record<string, number>;
  sample_key: string;
}

export interface Skipped {
  line: number;
  reason: string;
}

export interface ParseResult {
  samples: HealthSample[];
  skipped: Skipped[];
  /** Raw sleep stage readings received (before condensing into nights). */
  sleepReadings: number;
}

export const MAX_LINES = 5000;
const DAY = 86400000;

const METRIC_ALIASES: Record<string, Metric> = {
  workout: 'workout', workouts: 'workout', exercise: 'workout',
  mindful: 'mindful', mindfulness: 'mindful', 'mindful minutes': 'mindful', 'mindful session': 'mindful', meditation: 'mindful',
  sleep: 'sleep', 'sleep analysis': 'sleep',
  hrv: 'hrv', 'heart rate variability': 'hrv',
  resting_hr: 'resting_hr', 'resting hr': 'resting_hr', 'resting heart rate': 'resting_hr', resting: 'resting_hr',
};

const ISO = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/;

function parseDate(s: string): Date | null {
  const t = s.trim();
  if (!ISO.test(t)) return null;
  const d = new Date(t.replace(' ', 'T').replace(/([+-]\d{2})(\d{2})$/, '$1:$2'));
  return Number.isNaN(d.getTime()) ? null : d;
}

function parseNumber(s: string | undefined): number | null {
  const m = (s ?? '').match(/-?\d+(?:[.,]\d+)?/);
  return m ? Number(m[0].replace(',', '.')) : null;
}

const clean = (s: string | undefined, max: number) => {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, max) : null;
};

const minutes = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 60000);

// ---- Sleep ---------------------------------------------------------------

type Stage = 'core' | 'deep' | 'rem' | 'asleep' | 'awake' | 'in_bed';

function sleepStage(text: string | null): Stage | null {
  const t = (text ?? '').toLowerCase();
  if (!t) return null;
  if (t.includes('core') || t.includes('light')) return 'core';
  if (t.includes('deep')) return 'deep';
  if (t.includes('rem')) return 'rem';
  if (t.includes('awake')) return 'awake';
  if (t.includes('bed')) return 'in_bed';
  if (t.includes('asleep') || t.includes('sleep')) return 'asleep';
  return null;
}

interface Interval {
  start: number;
  end: number;
}

/** Total minutes covered by a set of intervals, counting overlaps once (several devices can record the same sleep). */
function unionMinutes(list: Interval[]): number {
  const sorted = [...list].sort((a, b) => a.start - b.start);
  let total = 0;
  let cur: Interval | null = null;
  for (const i of sorted) {
    if (!cur || i.start > cur.end) {
      if (cur) total += cur.end - cur.start;
      cur = { ...i };
    } else cur.end = Math.max(cur.end, i.end);
  }
  if (cur) total += cur.end - cur.start;
  return Math.round(total / 60000);
}

const SESSION_GAP_MS = 60 * 60000;

/** Condense stage readings into sleep sessions (gaps over an hour start a new one, e.g. a nap). */
export function condenseSleep(readings: { stage: Stage; start: Date; end: Date }[]): HealthSample[] {
  const sorted = [...readings].sort((a, b) => a.start.getTime() - b.start.getTime());
  const sessions: (typeof sorted)[] = [];
  let end = -Infinity;
  for (const r of sorted) {
    if (r.start.getTime() - end > SESSION_GAP_MS) sessions.push([]);
    sessions.at(-1)!.push(r);
    end = Math.max(end, r.end.getTime());
  }
  return sessions.map((s) => {
    const start = new Date(Math.min(...s.map((r) => r.start.getTime())));
    const stop = new Date(Math.max(...s.map((r) => r.end.getTime())));
    const of = (...stages: Stage[]) => unionMinutes(s.filter((r) => stages.includes(r.stage)).map((r) => ({ start: r.start.getTime(), end: r.end.getTime() })));
    const detail: Record<string, number> = {
      asleep: of('core', 'deep', 'rem', 'asleep'),
      core: of('core'),
      deep: of('deep'),
      rem: of('rem'),
      awake: of('awake'),
      in_bed: of('in_bed'),
    };
    for (const k of Object.keys(detail)) if (detail[k] === 0 && k !== 'asleep') delete detail[k];
    return {
      metric: 'sleep' as const,
      starts_at: start.toISOString(),
      ends_at: stop.toISOString(),
      value: detail.asleep || detail.in_bed || 0,
      unit: 'min',
      label: null,
      detail,
      sample_key: `sleep|${start.toISOString()}`,
    };
  });
}

// ---- Lines ----------------------------------------------------------------

export function parseLines(text: string, now = new Date()): ParseResult {
  const samples: HealthSample[] = [];
  const skipped: Skipped[] = [];
  const sleep: { stage: Stage; start: Date; end: Date }[] = [];
  const lines = text.split(/\r?\n/);
  const earliest = now.getTime() - 400 * DAY;
  const latest = now.getTime() + DAY;
  const seen = new Set<string>();

  lines.slice(0, MAX_LINES).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith('#')) return;
    const n = i + 1;
    const f = line.split('|').map((x) => x.trim());
    const metric = METRIC_ALIASES[(f[0] ?? '').toLowerCase().replace(/_/g, ' ').replace(/\s+/g, ' ').trim()]
      ?? METRIC_ALIASES[(f[0] ?? '').toLowerCase()];
    if (!metric) return skipped.push({ line: n, reason: `unknown type "${clean(f[0], 30) ?? ''}"` });
    const start = parseDate(f[1] ?? '');
    const end = parseDate(f[2] || f[1] || '');
    if (!start || !end) return skipped.push({ line: n, reason: 'dates must be ISO 8601 with a time zone (in Shortcuts, set the date format to ISO 8601)' });
    if (end < start) return skipped.push({ line: n, reason: 'ends before it starts' });
    if (start.getTime() < earliest || start.getTime() > latest) return skipped.push({ line: n, reason: 'date out of range' });
    const span = end.getTime() - start.getTime();

    if (metric === 'sleep') {
      const stage = sleepStage(clean(f[5], 40) ?? clean(f[3], 40));
      if (!stage) return skipped.push({ line: n, reason: 'sleep reading without a stage (Core, Deep, REM, Awake, In Bed…)' });
      if (span > 16 * 3600000) return skipped.push({ line: n, reason: 'sleep reading longer than 16 hours' });
      sleep.push({ stage, start, end });
      return;
    }

    let value: number | null;
    let unit: string | null;
    let label: string | null = null;
    let key: string;
    switch (metric) {
      case 'workout':
      case 'mindful':
        if (span > DAY) return skipped.push({ line: n, reason: 'longer than 24 hours' });
        value = minutes(start, end);
        unit = 'min';
        if (metric === 'workout') {
          const fromValue = clean(f[3], 100);
          label = clean(f[5], 100) ?? (fromValue && !/^\d/.test(fromValue) ? fromValue : null) ?? 'Workout';
        }
        key = `${metric}|${start.toISOString()}`;
        break;
      case 'hrv':
        value = parseNumber(f[3]);
        if (value === null || value <= 0 || value > 400) return skipped.push({ line: n, reason: 'HRV value missing or out of range' });
        unit = 'ms';
        key = `hrv|${start.toISOString()}`;
        break;
      case 'resting_hr':
        value = parseNumber(f[3]);
        if (value === null || value < 25 || value > 220) return skipped.push({ line: n, reason: 'resting heart rate missing or out of range' });
        unit = 'bpm';
        key = `resting_hr|${start.toISOString()}`;
        break;
    }
    if (seen.has(key)) return;
    seen.add(key);
    samples.push({ metric, starts_at: start.toISOString(), ends_at: end.toISOString(), value: value === null ? null : Math.round(value * 10) / 10, unit, label, detail: {}, sample_key: key });
  });

  if (lines.length > MAX_LINES) skipped.push({ line: MAX_LINES + 1, reason: `only the first ${MAX_LINES} lines are read` });
  return { samples: [...samples, ...condenseSleep(sleep)], skipped, sleepReadings: sleep.length };
}

/** A short, human summary for the Shortcut to show, e.g. "2 workouts, 1 night of sleep, 6 HRV readings". */
export function summarise(r: ParseResult): string {
  const count = (m: Metric) => r.samples.filter((s) => s.metric === m).length;
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n && parts.push(`${n} ${n === 1 ? one : many}`);
  add(count('workout'), 'workout', 'workouts');
  add(count('mindful'), 'mindful session', 'mindful sessions');
  add(count('sleep'), 'sleep session', 'sleep sessions');
  add(count('hrv'), 'HRV reading', 'HRV readings');
  add(count('resting_hr'), 'resting heart rate', 'resting heart rates');
  let msg = parts.length ? `Pilot received ${parts.join(', ')}.` : 'Pilot received the request but found no readings.';
  if (r.skipped.length) {
    const first = r.skipped[0]!;
    msg += ` Skipped ${r.skipped.length} line${r.skipped.length === 1 ? '' : 's'} (line ${first.line}: ${first.reason}).`;
  }
  return msg;
}
