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

const MAX_OCCURRENCES_PER_SERIES = 1000;
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

/** Parse one feed into the occurrences that overlap `w`. Throws on unparseable input. */
export function parseFeed(ics: string, sourceId: string, w: Window): ImportedEvent[] {
  const root = new ICAL.Component(ICAL.parse(ics));

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
    const event = new ICAL.Event(master);
    for (const ex of exceptions.get(uid) ?? []) event.relateException(ex);

    if (!event.isRecurring()) {
      if (isCancelled(master)) continue;
      const ev = toEvent(uid, event.startDate.toString(), cleanTitle(event.summary), event.startDate, event.endDate, sourceId);
      if (inWindow(ev, w)) out.push(ev);
      continue;
    }

    if (isCancelled(master)) continue;
    const it = event.iterator();
    for (let i = 0, next = it.next(); next && i < MAX_OCCURRENCES_PER_SERIES; i++, next = it.next()) {
      if (next.compare(toTime) > 0) break;
      const d = event.getOccurrenceDetails(next);
      if (isCancelled(d.item.component)) continue;
      const ev = toEvent(uid, d.recurrenceId.toString(), cleanTitle(d.item.summary), d.startDate, d.endDate, sourceId);
      if (inWindow(ev, w)) out.push(ev);
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
