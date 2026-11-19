/**
 * iCalendar (ICS) → imported events. Pure and dependency-light so it runs in
 * the Edge Function (Deno) and in unit tests (Node) unchanged.
 *
 * - Expands recurring events within a window, honouring EXDATE, moved
 *   occurrences (RECURRENCE-ID overrides) and cancellations.
 * - Uses the VTIMEZONE definitions inside the feed, so Google (IANA names)
 *   and Outlook (Windows names like "GMT Standard Time") both resolve.
 * - Keeps only what Pilot needs: title, times, all-day. No attendees,
 *   descriptions or locations.
 */
import ICAL from 'ical.js';

export interface ImportedEvent {
  event_key: string; // series + occurrence; stable across refreshes
  series_key: string; // calendar UID
  title: string | null;
  all_day: boolean;
  starts_at: string | null; // ISO instant (timed events)
  ends_at: string | null;
  start_date: string | null; // YYYY-MM-DD (all-day; end exclusive)
  end_date: string | null;
  source_ids: string[];
}

export interface Window {
  from: Date;
  to: Date;
}

/**
 * Old repeating events (e.g. a daily reminder since 2019) have thousands of
 * past occurrences that must be stepped over to reach the window. Stepping is
 * cheap; the caps only guard against pathological rules.
 */
const MAX_STEPS_PER_SERIES = 50_000;
const MAX_OCCURRENCES_PER_SERIES = 2_000;
const MAX_TITLE = 500;

type ICalComponent = InstanceType<typeof ICAL.Component>;
type ICalTime = InstanceType<typeof ICAL.Time>;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

function addDaysIso(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDate(d);
}

function dateString(t: ICalTime): string {
  return `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function cleanTitle(s: unknown): string | null {
  if (typeof s !== 'string') return null;
  const t = s.replace(/\s+/g, ' ').trim();
  return t ? t.slice(0, MAX_TITLE) : null;
}

function isCancelled(c: ICalComponent): boolean {
  return String(c.getFirstPropertyValue('status') ?? '').toUpperCase() === 'CANCELLED';
}

function toEvent(
  seriesKey: string,
  occurrenceKey: string,
  title: string | null,
  start: ICalTime,
  end: ICalTime | null,
  sourceId: string,
): ImportedEvent {
  if (start.isDate) {
    const startDate = dateString(start);
    let endDate = end ? dateString(end) : addDaysIso(startDate, 1);
    if (endDate <= startDate) endDate = addDaysIso(startDate, 1);
    return { event_key: `${seriesKey}|${occurrenceKey}`, series_key: seriesKey, title, all_day: true, starts_at: null, ends_at: null, start_date: startDate, end_date: endDate, source_ids: [sourceId] };
  }
  const s = start.toJSDate();
  let e = end ? end.toJSDate() : s;
  if (e < s) e = s;
  return { event_key: `${seriesKey}|${occurrenceKey}`, series_key: seriesKey, title, all_day: false, starts_at: s.toISOString(), ends_at: e.toISOString(), start_date: null, end_date: null, source_ids: [sourceId] };
}

function inWindow(ev: ImportedEvent, w: Window): boolean {
  if (ev.all_day) return ev.end_date! > isoDate(w.from) && ev.start_date! <= isoDate(w.to);
  return Date.parse(ev.ends_at!) >= w.from.getTime() && Date.parse(ev.starts_at!) <= w.to.getTime();
}

// ---------------------------------------------------------------------------
// Performance. Supabase gives a function ~2 s of CPU per request. Building
// ical.js objects is the expensive part (~0.3 ms per event), and a calendar
// with years of history has thousands of events nowhere near the window. So:
//   1. skim the raw parsed data (jCal) and drop one-off events whose dates are
//      clearly outside the window before building any objects;
//   2. fast-forward old open-ended DAILY/WEEKLY series to just before the
//      window instead of stepping through years of past occurrences.
// ---------------------------------------------------------------------------

type JCalProp = [string, Record<string, unknown>, string, ...unknown[]];
type JCalComp = [string, JCalProp[], JCalComp[]];

const DAY = 86400000;
/** Generous margins: wall-clock dates vs UTC, and events spanning the window edge. */
const SKIM_MARGIN_DAYS = 3;
const LONG_EVENT_DAYS = 60;

function hasProp(c: JCalComp, name: string): boolean {
  return c[1].some((x) => x[0] === name);
}

/** A property's raw text value (dates are "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM:SS[Z]"). */
function propValue(c: JCalComp, name: string): string | undefined {
  const v = c[1].find((x) => x[0] === name)?.[3];
  return typeof v === 'string' ? v : undefined;
}

/** Cheap pre-filter on raw jCal: keep everything that might touch the window. */
export function skim(cal: JCalComp, w: Window): JCalComp {
  const lo = isoDate(new Date(w.from.getTime() - SKIM_MARGIN_DAYS * DAY));
  const loLong = isoDate(new Date(w.from.getTime() - LONG_EVENT_DAYS * DAY));
  const hi = isoDate(new Date(w.to.getTime() + SKIM_MARGIN_DAYS * DAY));
  const keep = cal[2].filter((c) => {
    if (c[0] !== 'vevent') return true;
    if (hasProp(c, 'rrule') || hasProp(c, 'rdate')) return true; // series: handled later
    const start = propValue(c, 'dtstart')?.slice(0, 10);
    if (!start) return true; // unusual; let the full parser decide
    const end = propValue(c, 'dtend')?.slice(0, 10);
    const near = start <= hi && (end !== undefined ? end >= lo : start >= (hasProp(c, 'duration') ? loLong : lo));
    const rid = propValue(c, 'recurrence-id')?.slice(0, 10);
    return near || (rid !== undefined && rid >= lo && rid <= hi); // a moved occurrence whose original slot is in the window
  });
  return [cal[0], cal[1], keep];
}

/**
 * Move DTSTART (and DTEND) of an old open-ended DAILY/WEEKLY series forward
 * by whole periods. Same time of day, same weekday, same phase for INTERVAL,
 * so every occurrence near the window (and its RECURRENCE-ID) is unchanged.
 * Series with COUNT, RDATE or several RRULEs are left alone.
 */
function fastForward(master: ICalComponent, w: Window): void {
  const rrules = master.getAllProperties('rrule');
  if (rrules.length !== 1 || master.hasProperty('rdate')) return;
  const rule = rrules[0]!.getFirstValue() as InstanceType<typeof ICAL.Recur>;
  if (rule.count || (rule.freq !== 'DAILY' && rule.freq !== 'WEEKLY')) return;
  const startProp = master.getFirstProperty('dtstart');
  if (!startProp) return;
  const start = startProp.getFirstValue() as ICalTime;
  const periodDays = (rule.interval || 1) * (rule.freq === 'WEEKLY' ? 7 : 1);
  const target = w.from.getTime() - 14 * DAY; // well before the window
  const periods = Math.floor((target - start.toJSDate().getTime()) / (periodDays * DAY));
  if (periods < 2) return;
  const shiftDays = (periods - 1) * periodDays;
  const newStart = start.clone();
  newStart.adjust(shiftDays, 0, 0, 0);
  startProp.setValue(newStart);
  const endProp = master.getFirstProperty('dtend');
  if (endProp) {
    const end = (endProp.getFirstValue() as ICalTime).clone();
    end.adjust(shiftDays, 0, 0, 0);
    endProp.setValue(end);
  }
}

/** Parse one feed into the occurrences that overlap `w`. Throws on unparseable input. */
export function parseFeed(ics: string, sourceId: string, w: Window): ImportedEvent[] {
  let parsed = ICAL.parse(ics) as unknown as JCalComp | JCalComp[];
  if (Array.isArray(parsed[0])) parsed = (parsed as JCalComp[])[0]!; // several VCALENDARs: use the first
  const cal = parsed as JCalComp;
  if (cal[0] !== 'vcalendar') throw new Error('Not a calendar');
  const root = new ICAL.Component(skim(cal, w));

  for (const tz of root.getAllSubcomponents('vtimezone')) {
    try {
      ICAL.TimezoneService.register(tz);
    } catch {
      // A malformed zone shouldn't sink the whole calendar.
    }
  }

  const vevents = root.getAllSubcomponents('vevent');
  const masters = new Map<string, ICalComponent>();
  const exceptions = new Map<string, ICalComponent[]>();
  for (const c of vevents) {
    const uid = String(c.getFirstPropertyValue('uid') ?? '').trim();
    if (!uid) continue;
    if (c.hasProperty('recurrence-id')) exceptions.set(uid, [...(exceptions.get(uid) ?? []), c]);
    else masters.set(uid, c);
  }

  const out: ImportedEvent[] = [];
  const toTime = ICAL.Time.fromJSDate(w.to, true);

  for (const [uid, master] of masters) {
    if (master.hasProperty('rrule')) fastForward(master, w);
    const event = new ICAL.Event(master);
    const movedIds = new Set<string>(); // occurrences overridden by a RECURRENCE-ID component
    for (const ex of exceptions.get(uid) ?? []) {
      event.relateException(ex);
      movedIds.add(String(ex.getFirstPropertyValue('recurrence-id')));
    }

    if (!event.isRecurring()) {
      if (isCancelled(master)) continue;
      const ev = toEvent(uid, event.startDate.toString(), cleanTitle(event.summary), event.startDate, event.endDate, sourceId);
      if (inWindow(ev, w)) out.push(ev);
      continue;
    }

    if (isCancelled(master)) continue;
    const it = event.iterator();
    const fromTime = ICAL.Time.fromJSDate(new Date(w.from.getTime() - 2 * 86400000), true); // margin for long events
    let kept = 0;
    for (let i = 0, next = it.next(); next && i < MAX_STEPS_PER_SERIES && kept < MAX_OCCURRENCES_PER_SERIES; i++, next = it.next()) {
      if (next.compare(toTime) > 0) break;
      if (next.compare(fromTime) < 0 && !movedIds.has(next.toString())) continue; // long before the window
      const d = event.getOccurrenceDetails(next);
      if (isCancelled(d.item.component)) continue;
      const ev = toEvent(uid, d.recurrenceId.toString(), cleanTitle(d.item.summary), d.startDate, d.endDate, sourceId);
      if (inWindow(ev, w)) {
        out.push(ev);
        kept++;
      }
    }
  }

  // Overrides whose master isn't in the feed: treat as standalone events.
  for (const [uid, list] of exceptions) {
    if (masters.has(uid)) continue;
    for (const c of list) {
      if (isCancelled(c)) continue;
      const e = new ICAL.Event(c);
      const ev = toEvent(uid, String(c.getFirstPropertyValue('recurrence-id')), cleanTitle(e.summary), e.startDate, e.endDate, sourceId);
      if (inWindow(ev, w)) out.push(ev);
    }
  }

  return out;
}

const norm = (s: string | null) => (s ?? '').toLocaleLowerCase().replace(/\s+/g, ' ').trim();
const when = (e: ImportedEvent) => (e.all_day ? `d:${e.start_date}/${e.end_date}` : `t:${e.starts_at}/${e.ends_at}`);

/**
 * Merge events from several calendars. The same event shared into two
 * calendars usually keeps its UID (same event_key); otherwise identical
 * title + times are treated as the same thing. Sources are unioned.
 */
export function mergeCalendars(lists: ImportedEvent[][]): ImportedEvent[] {
  const byKey = new Map<string, ImportedEvent>();
  const bySignature = new Map<string, ImportedEvent>();
  for (const list of lists) {
    for (const ev of list) {
      const sig = `${norm(ev.title)}|${when(ev)}`;
      const existing = byKey.get(ev.event_key) ?? (norm(ev.title) ? bySignature.get(sig) : undefined);
      if (existing) {
        for (const s of ev.source_ids) if (!existing.source_ids.includes(s)) existing.source_ids.push(s);
        continue;
      }
      const copy = { ...ev, source_ids: [...ev.source_ids] };
      byKey.set(ev.event_key, copy);
      bySignature.set(sig, copy);
    }
  }
  return [...byKey.values()].sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

const sortKey = (e: ImportedEvent) => (e.all_day ? `${e.start_date}T00:00:00.000Z` : e.starts_at!);

/** The rolling import window: a week back, two weeks ahead. */
export function importWindow(now = new Date()): Window {
  return { from: new Date(now.getTime() - 7 * 86400000), to: new Date(now.getTime() + 14 * 86400000) };
}
