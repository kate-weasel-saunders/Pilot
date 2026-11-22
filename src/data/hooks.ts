import { useLiveQuery } from 'dexie-react-hooks';
import { db } from './db';
import type { CalendarEvent, CalendarSource, CheckIn, EventSeries, HealthSampleRow, Period, Tag } from './types';
import { buildContext } from '../lib/calendar';
import { healthToEvents } from '../lib/health';
import { indexByDay } from '../lib/healthDaily';
import { deviceTimeZone } from '../lib/time';

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
      const since = new Date(Date.now() - 21 * 86400000).toISOString();
      const [events, series, sources, health] = await Promise.all([
        db.calendar_events.toArray(),
        db.event_series.toArray(),
        db.calendar_sources.toArray(),
        db.health_samples.where('starts_at').above(since).toArray(),
      ]);
      return { events: [...events, ...healthToEvents(health)], ctx: buildContext(series, sources), hasCalendars: sources.length > 0 };
    },
    [],
    { events: [] as CalendarEvent[], ctx: buildContext([] as EventSeries[], [] as CalendarSource[]), hasCalendars: false },
  );
  return data;
}

/** Health samples grouped by local day (sleep by wake date). */
export const useHealthByDay = () =>
  useLiveQuery(async () => indexByDay(await db.health_samples.toArray(), deviceTimeZone()), [], new Map<string, HealthSampleRow[]>());
