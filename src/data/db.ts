import Dexie, { type Table } from 'dexie';
import type { CalendarEvent, CalendarSource, CheckIn, EventSeries, OutboxEntry, Period, Tag } from './types';

/**
 * On-device store (IndexedDB). The UI reads exclusively from here, so it works
 * offline and renders instantly. The server is the durable copy; the outbox
 * holds changes that haven't reached it yet. Cleared on sign-out.
 */
export class PilotDB extends Dexie {
  check_ins!: Table<CheckIn, string>;
  periods!: Table<Period, string>;
  tags!: Table<Tag, string>;
  calendar_sources!: Table<CalendarSource, string>;
  calendar_events!: Table<CalendarEvent, string>;
  event_series!: Table<EventSeries, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'pilot') {
    super(name);
    this.version(1).stores({
      check_ins: 'id, observed_at, local_date, updated_at',
      periods: 'id, start_date',
      tags: 'id, kind',
      outbox: 'key, queued_at',
      meta: 'key',
    });
    this.version(2)
      .stores({
        calendar_sources: 'id',
        calendar_events: 'id, event_key, starts_at, start_date',
        event_series: 'id, series_key',
      })
      .upgrade((tx) => tx.table('check_ins').toCollection().modify((c) => {
        c.events ??= [];
      }));
  }
}

export const db = new PilotDB();

export async function getMeta<T>(d: PilotDB, key: string): Promise<T | undefined> {
  return (await d.meta.get(key))?.value as T | undefined;
}

export async function setMeta(d: PilotDB, key: string, value: unknown): Promise<void> {
  await d.meta.put({ key, value });
}

/** Wipe everything on this device (used on sign-out / account switch). */
export async function clearLocal(d: PilotDB): Promise<void> {
  const tables = [d.check_ins, d.periods, d.tags, d.calendar_sources, d.calendar_events, d.event_series, d.outbox, d.meta];
  await d.transaction('rw', tables, async () => {
    await Promise.all(tables.map((t) => t.clear()));
  });
}
