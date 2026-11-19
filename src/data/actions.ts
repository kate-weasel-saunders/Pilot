import { db } from './db';
import { deleteRow, saveRow } from './repo';
import { requestSync } from './syncController';
import { newId } from './repo';
import type { CalendarSource, CheckIn, EventSeries, Period, Tag } from './types';

/** App-level write actions: save locally, then nudge sync. */

export async function saveCheckIn(c: CheckIn) {
  const saved = await saveRow(db, 'check_ins', c);
  requestSync();
  return saved;
}
export async function removeCheckIn(id: string) {
  await deleteRow(db, 'check_ins', id);
  requestSync();
}
export async function savePeriod(p: Period) {
  const saved = await saveRow(db, 'periods', p);
  requestSync();
  return saved;
}
export async function removePeriod(id: string) {
  await deleteRow(db, 'periods', id);
  requestSync();
}
export async function saveTag(t: Tag) {
  const saved = await saveRow(db, 'tags', t);
  requestSync();
  return saved;
}

export async function saveCalendarSource(s: CalendarSource) {
  const saved = await saveRow(db, 'calendar_sources', s);
  requestSync();
  return saved;
}
export async function removeCalendarSource(id: string) {
  await deleteRow(db, 'calendar_sources', id);
  requestSync();
}

/** Set preferences for an event series (kind, renamed title, don't pre-select). */
export async function saveSeriesPref(seriesKey: string, patch: Partial<Pick<EventSeries, 'kind' | 'title_override' | 'hidden'>>) {
  const existing = (await db.event_series.where('series_key').equals(seriesKey).toArray()).sort((a, b) => a.updated_at.localeCompare(b.updated_at)).at(-1);
  const row: EventSeries = existing
    ? { ...existing, ...patch }
    : { id: newId(), series_key: seriesKey, kind: null, title_override: null, hidden: false, created_at: new Date().toISOString(), updated_at: '', ...patch };
  const saved = await saveRow(db, 'event_series', row);
  requestSync();
  return saved;
}
