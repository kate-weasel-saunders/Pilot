/**
 * Apple Health lines (sent by an iOS Shortcut) → health samples. Pure, so it
 * runs in the Edge Function (Deno) and in unit tests (Node) unchanged.
 *
 * One reading per line, fields separated by "|":
 *
 *   type | start | end | value | unit | label
 *
 * `type` can be Pilot's short name or Apple Health's own name, so a Shortcut
 * can use one template for every sample: "Type | Start | End | Value | Unit".
 * Types Pilot doesn't use (steps, wrist temperature…) are counted and ignored.
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
 * Sleep stage samples are condensed into one summary per night, and
 * Apple Health "Exercise Minutes" into active periods (a run, the gym, a long
 * brisk walk: anything the watch counted as exercise for 10+ minutes).
 * Internally these are metric 'workout' with label 'Exercise'; the app shows
 * them as "Active".
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
  /** Readings of types Pilot doesn't use, by type name. */
  ignored: Record<string, number>;
  /** Raw sleep stage readings received (before condensing into nights). */
  sleepReadings: number;
}

export const MAX_LINES = 5000;
const DAY = 86400000;

type LineKind = Metric | 'exercise';

const METRIC_ALIASES: Record<string, LineKind> = {
  workout: 'workout', workouts: 'workout',
  exercise: 'exercise', 'exercise minutes': 'exercise', 'exercise time': 'exercise', 'apple exercise time': 'exercise',
  mindful: 'mindful', mindfulness: 'mindful', 'mindful minutes': 'mindful', 'mindful session': 'mindful', meditation: 'mindful',
  sleep: 'sleep', 'sleep analysis': 'sleep',
  hrv: 'hrv', 'heart rate variability': 'hrv',
  resting_hr: 'resting_hr', 'resting hr': 'resting_hr', 'resting heart rate': 'resting_hr', resting: 'resting_hr',
  'heart rate variability sdnn': 'hrv', 'hrv sdnn': 'hrv', 'mindfulness minutes': 'mindful',
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

// ---- Exercise --------------------------------------------------------------

/** Readings closer than this belong to the same session. */
const EXERCISE_GAP_MS = 15 * 60000;
/**
 * Apple Watch counts any brisk minute as exercise (a quick walk, a dash for a
 * train). Only sessions at least this long are treated as exercise.
 */
export const MIN_EXERCISE_SESSION_MIN = 10;

/** Merge Exercise Minutes readings into sessions, e.g. one 35-minute run. */
export function condenseExercise(readings: { start: Date; end: Date; minutes: number }[]): HealthSample[] {
  const sorted = [...readings].sort((a, b) => a.start.getTime() - b.start.getTime());
  const sessions: (typeof sorted)[] = [];
  let end = -Infinity;
  for (const r of sorted) {
    if (r.start.getTime() - end > EXERCISE_GAP_MS) sessions.push([]);
    sessions.at(-1)!.push(r);
    end = Math.max(end, r.end.getTime());
  }
  return sessions
    .map((s) => {
      const start = new Date(Math.min(...s.map((r) => r.start.getTime())));
      const stop = new Date(Math.max(...s.map((r) => r.end.getTime())));
      const total = Math.min(s.reduce((n, r) => n + r.minutes, 0), Math.max(1, minutes(start, stop)));
      return {
        metric: 'workout' as const,
        starts_at: start.toISOString(),
        ends_at: stop.toISOString(),
        value: Math.round(total),
        unit: 'min',
        label: 'Exercise',
        detail: {},
        sample_key: `workout|exercise|${start.toISOString()}`,
      };
    })
    .filter((x) => x.value >= MIN_EXERCISE_SESSION_MIN);
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
  const exercise: { start: Date; end: Date; minutes: number }[] = [];
  const ignored: Record<string, number> = {};
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
    if (!metric) {
      // A type Pilot doesn't use (e.g. a catch-all Shortcut sending Steps): note it, don't complain.
      const name = clean(f[0], 40) ?? 'unknown';
      ignored[name] = (ignored[name] ?? 0) + 1;
      return;
    }
    const start = parseDate(f[1] ?? '');
    const end = parseDate(f[2] || f[1] || '');
    if (!start || !end) return skipped.push({ line: n, reason: 'dates must be ISO 8601 with a time zone (in Shortcuts, set the date format to ISO 8601)' });
    if (end < start) return skipped.push({ line: n, reason: 'ends before it starts' });
    if (start.getTime() < earliest || start.getTime() > latest) return skipped.push({ line: n, reason: 'date out of range' });
    const span = end.getTime() - start.getTime();

    if (metric === 'exercise') {
      if (span > DAY) return skipped.push({ line: n, reason: 'longer than 24 hours' });
      const v = parseNumber(f[3]);
      // Exercise Minutes carry their minutes as the value; fall back to the span.
      const mins = v !== null && v > 0 && v <= span / 60000 + 1 ? v : span / 60000;
      exercise.push({ start, end, minutes: mins });
      return;
    }

    if (metric === 'sleep') {
      // If the stage isn't recognisable (iOS versions differ), count it as sleep rather than lose it.
      const stage = sleepStage(clean(f[5], 40)) ?? sleepStage(clean(f[3], 40)) ?? 'asleep';
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
  return { samples: [...samples, ...condenseSleep(sleep), ...condenseExercise(exercise)], skipped, ignored, sleepReadings: sleep.length };
}

/** A short, human summary for the Shortcut to show, e.g. "2 workouts, 1 night of sleep, 6 HRV readings". */
export function summarise(r: ParseResult): string {
  const count = (m: Metric) => r.samples.filter((s) => s.metric === m).length;
  const parts: string[] = [];
  const add = (n: number, one: string, many: string) => n && parts.push(`${n} ${n === 1 ? one : many}`);
  const active = r.samples.filter((s) => s.metric === 'workout' && s.label === 'Exercise').length;
  add(active, 'active period', 'active periods');
  add(count('workout') - active, 'workout', 'workouts');
  add(count('mindful'), 'mindful session', 'mindful sessions');
  add(count('sleep'), 'sleep session', 'sleep sessions');
  add(count('hrv'), 'HRV reading', 'HRV readings');
  add(count('resting_hr'), 'resting heart rate', 'resting heart rates');
  let msg = parts.length ? `Pilot received ${parts.join(', ')}.` : 'Pilot received the request but found no readings it uses.';
  const ignoredTypes = Object.keys(r.ignored);
  if (ignoredTypes.length) {
    const total = Object.values(r.ignored).reduce((a, b) => a + b, 0);
    msg += ` Ignored ${total} reading${total === 1 ? '' : 's'} of types Pilot doesn’t use (${ignoredTypes.slice(0, 3).join(', ')}${ignoredTypes.length > 3 ? '…' : ''}).`;
  }
  if (r.skipped.length) {
    const first = r.skipped[0]!;
    msg += ` Skipped ${r.skipped.length} line${r.skipped.length === 1 ? '' : 's'} (line ${first.line}: ${first.reason}).`;
  }
  return msg;
}
