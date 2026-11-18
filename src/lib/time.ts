/**
 * Time helpers. A check-in stores the instant (observed_at) *and* the
 * wall-clock date/time in the zone it was made in. Everything here is pure and
 * zone-explicit so it can be tested without depending on the machine's zone.
 */

export type PartOfDay = 'morning' | 'afternoon' | 'evening' | 'late night';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export function deviceTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

interface WallClock {
  date: string; // YYYY-MM-DD
  time: string; // HH:MM:SS
}

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();
function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let f = partsFormatterCache.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    partsFormatterCache.set(timeZone, f);
  }
  return f;
}

/** Wall-clock date and time of `instant` in `timeZone`. */
export function wallClock(instant: Date, timeZone: string): WallClock {
  const p: Record<string, string> = {};
  for (const part of partsFormatter(timeZone).formatToParts(instant)) p[part.type] = part.value;
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

/** Offset of `timeZone` from UTC at `instant`, in minutes. */
function offsetMinutes(instant: Date, timeZone: string): number {
  const { date, time } = wallClock(instant, timeZone);
  const asUtc = Date.parse(`${date}T${time}Z`);
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60000);
}

/**
 * The instant at which the wall clock in `timeZone` reads `date` `time`.
 * Handles DST by re-checking the offset at the candidate instant. For a time
 * that doesn't exist (spring-forward gap) the result lands just after the gap.
 */
export function instantFromWallClock(date: string, time: string, timeZone: string): Date {
  const hhmmss = time.length === 5 ? `${time}:00` : time;
  const naiveUtc = Date.parse(`${date}T${hhmmss}Z`);
  if (Number.isNaN(naiveUtc)) throw new Error(`Invalid date/time: ${date} ${time}`);
  let guess = naiveUtc - offsetMinutes(new Date(naiveUtc), timeZone) * 60000;
  const second = naiveUtc - offsetMinutes(new Date(guess), timeZone) * 60000;
  if (second !== guess) guess = second;
  return new Date(guess);
}

/** Fields stored on a check-in for a given instant and zone. */
export function localFields(instant: Date, timeZone: string) {
  const { date, time } = wallClock(instant, timeZone);
  return { observed_at: instant.toISOString(), timezone: timeZone, local_date: date, local_time: time };
}

export function partOfDay(localTime: string): PartOfDay {
  const hour = Number(localTime.slice(0, 2));
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 22) return 'evening';
  return 'late night';
}

/** Weekday of a YYYY-MM-DD calendar date (zone-independent). */
export function weekdayOf(localDate: string): Weekday {
  return WEEKDAYS[new Date(`${localDate}T12:00:00Z`).getUTCDay()]!;
}

export function isWeekend(localDate: string): boolean {
  const d = weekdayOf(localDate);
  return d === 'Saturday' || d === 'Sunday';
}

/** Add whole days to a YYYY-MM-DD date. */
export function addDays(localDate: string, days: number): string {
  const d = new Date(`${localDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function todayLocal(timeZone = deviceTimeZone(), now = new Date()): string {
  return wallClock(now, timeZone).date;
}

// ---- Display formatting (uses the device locale) ----

export function formatDayHeading(localDate: string, today = todayLocal()): string {
  if (localDate === today) return 'Today';
  if (localDate === addDays(today, -1)) return 'Yesterday';
  const d = new Date(`${localDate}T12:00:00Z`);
  const sameYear = localDate.slice(0, 4) === today.slice(0, 4);
  return d.toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  });
}

export function formatShortDate(localDate: string): string {
  const d = new Date(`${localDate}T12:00:00Z`);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function formatTime(localTime: string): string {
  return localTime.slice(0, 5);
}
