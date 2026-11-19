import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { CalendarEvent, CalendarSource, CheckIn, EventSeries, Period, Tag } from './types';
import { buildContext } from '../lib/calendar';

export const usePeriods = () => useLiveQuery(() => db.periods.orderBy('start_date').toArray(), [], [] as Period[]);

/** All check-ins, newest first. Data volume for one person stays small. */
export const useCheckIns = () =>
  useLiveQuery(() => db.check_ins.orderBy('observed_at').reverse().toArray(), [], undefined as CheckIn[] | undefined);

export const usePendingIds = () =>
  useLiveQuery(async () => new Set((await db.outbox.toArray()).map((e) => e.id)), [], new Set<string>());

export const useTags = () => useLiveQuery(() => db.tags.toArray(), [], [] as Tag[]);
export const useCalendarSources = () => useLiveQuery(() => db.calendar_sources.toArray(), [], undefined as CalendarSource[] | undefined);

/** Calendar events plus the context needed to interpret them. */
export function useCalendar() {
  const data = useLiveQuery(
    async () => {
      const [events, series, sources] = await Promise.all([db.calendar_events.toArray(), db.event_series.toArray(), db.calendar_sources.toArray()]);
      return { events, ctx: buildContext(series, sources), hasCalendars: sources.length > 0 };
    },
    [],
    { events: [] as CalendarEvent[], ctx: buildContext([] as EventSeries[], [] as CalendarSource[]), hasCalendars: false },
  );
  return data;
}
