import type { CalendarEvent, CalendarSource, EventRelation, EventSeries, EventSnapshot } from '../data/types';
import { wallClock } from './time';

/**
 * Which calendar events belong with a check-in.
 *
 * Default rule (pre-ticked): a timed event that starts within the next
 * LOOKAHEAD_HOURS, is happening now, or ended within the last AFTER_HOURS;
 * an all-day/multi-day event covering the check-in's date. Everything else on
 * the same day is offered but not ticked. The user can always change it.
 */
export const LOOKAHEAD_HOURS = 12;
export const AFTER_HOURS = 3;

const H = 3600_000;

export interface EventContext {
  series: Map<string, EventSeries>; // by series_key
  sources: Map<string, CalendarSource>; // by id
}

export function buildContext(series: EventSeries[], sources: CalendarSource[]): EventContext {
  const bySeries = new Map<string, EventSeries>();
  // If two devices created prefs for the same series, the latest wins.
  for (const s of [...series].sort((a, b) => a.updated_at.localeCompare(b.updated_at))) bySeries.set(s.series_key, s);
  return { series: bySeries, sources: new Map(sources.map((s) => [s.id, s])) };
}

/** Events from calendars that still exist and are switched on. */
export function liveEvents(events: CalendarEvent[], ctx: EventContext): CalendarEvent[] {
  return events.filter((e) => e.source_ids.some((id) => ctx.sources.get(id)?.enabled));
}

export function displayTitle(e: Pick<CalendarEvent, 'series_key' | 'title'>, ctx: EventContext): string {
  return ctx.series.get(e.series_key)?.title_override || e.title || 'Untitled event';
}

export function resolveKind(e: Pick<CalendarEvent, 'series_key' | 'source_ids'>, ctx: EventContext): string | null {
  const own = ctx.series.get(e.series_key)?.kind;
  if (own) return own;
  for (const id of e.source_ids) {
    const k = ctx.sources.get(id)?.default_kind;
    if (k) return k;
  }
  return null;
}

/** How `e` relates to a check-in at `at` on local date `localDate`. */
export function relationTo(e: CalendarEvent, at: Date, localDate: string): { relation: EventRelation; offset_min: number; suggested: boolean } {
  if (e.all_day) {
    const covers = e.start_date! <= localDate && localDate < e.end_date!;
    return { relation: covers ? 'all_day' : e.start_date! > localDate ? 'later' : 'earlier', offset_min: 0, suggested: covers };
  }
  const t = at.getTime();
  const start = Date.parse(e.starts_at!);
  const end = Date.parse(e.ends_at!);
  if (t < start) {
    const offset = Math.round((start - t) / 60000);
    const suggested = start - t <= LOOKAHEAD_HOURS * H;
    return { relation: suggested ? 'upcoming' : 'later', offset_min: offset, suggested };
  }
  if (t <= end) return { relation: 'now', offset_min: 0, suggested: true };
  const suggested = t - end <= AFTER_HOURS * H;
  return { relation: suggested ? 'recent' : 'earlier', offset_min: -Math.round((t - end) / 60000), suggested };
}

/** Does the event touch `localDate` in `timeZone`? */
export function onDate(e: CalendarEvent, localDate: string, timeZone: string): boolean {
  if (e.all_day) return e.start_date! <= localDate && localDate < e.end_date!;
  const startDay = wallClock(new Date(e.starts_at!), timeZone).date;
  const endDay = wallClock(new Date(e.ends_at!), timeZone).date;
  return startDay <= localDate && localDate <= endDay;
}

export interface Candidates {
  suggested: CalendarEvent[]; // pre-ticked by the default rule
  others: CalendarEvent[]; // same day, offered but not ticked
}

export function candidatesFor(events: CalendarEvent[], at: Date, localDate: string, timeZone: string, ctx: EventContext): Candidates {
  const suggested: CalendarEvent[] = [];
  const others: CalendarEvent[] = [];
  for (const e of liveEvents(events, ctx)) {
    const r = relationTo(e, at, localDate);
    if (r.suggested && !ctx.series.get(e.series_key)?.hidden) suggested.push(e);
    else if (r.suggested || onDate(e, localDate, timeZone)) others.push(e);
  }
  const order = (e: CalendarEvent) => (e.all_day ? `0${e.start_date}` : `1${e.starts_at}`);
  suggested.sort((a, b) => order(a).localeCompare(order(b)));
  others.sort((a, b) => order(a).localeCompare(order(b)));
  return { suggested, others };
}

export function snapshotOf(e: CalendarEvent, at: Date, localDate: string, ctx: EventContext): EventSnapshot {
  const { relation, offset_min } = relationTo(e, at, localDate);
  return {
    key: e.event_key,
    series_key: e.series_key,
    title: displayTitle(e, ctx),
    kind: resolveKind(e, ctx),
    all_day: e.all_day,
    starts_at: e.starts_at,
    ends_at: e.ends_at,
    start_date: e.start_date,
    end_date: e.end_date,
    relation,
    offset_min,
  };
}

/** Short time label for an event, in the viewer's zone. */
export function timeLabel(e: Pick<EventSnapshot, 'all_day' | 'starts_at' | 'start_date' | 'end_date'>, timeZone: string): string {
  if (e.all_day) {
    const days = Math.round((Date.parse(e.end_date!) - Date.parse(e.start_date!)) / 86400000);
    return days > 1 ? `${days} days` : 'All day';
  }
  return wallClock(new Date(e.starts_at!), timeZone).time.slice(0, 5);
}

export function relationLabel(s: Pick<EventSnapshot, 'relation' | 'offset_min'>): string {
  const span = (min: number) => {
    const m = Math.abs(min);
    if (m < 60) return `${m} min`;
    const h = Math.round(m / 60);
    return h === 1 ? '1 hour' : `${h} hours`;
  };
  switch (s.relation) {
    case 'upcoming':
    case 'later':
      return `in ${span(s.offset_min)}`;
    case 'now':
      return 'now';
    case 'recent':
    case 'earlier':
      return `${span(s.offset_min)} ago`;
    case 'all_day':
      return 'today';
  }
}
