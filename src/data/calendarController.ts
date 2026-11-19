import { db, getMeta, setMeta } from './db';
import { supabase } from '../lib/supabase';
import type { CalendarSource } from './types';

/**
 * Calendar import runs on the server (the `calendar` Edge Function), which
 * holds the secret feed links. The device asks for a refresh now and then and
 * receives the events through normal sync.
 */

const REFRESH_EVERY_MS = 30 * 60 * 1000;
const LAST_KEY = 'calendar:last-refresh';

export class CalendarError extends Error {}

async function call<T>(body: Record<string, unknown>): Promise<T> {
  if (!supabase) throw new CalendarError('Not configured.');
  if (!navigator.onLine) throw new CalendarError('You’re offline. Calendars need a connection.');
  const { data, error } = await supabase.functions.invoke('calendar', { body });
  if (error) {
    let message = 'Couldn’t reach Pilot’s server. Try again in a moment.';
    try {
      const res = (error as { context?: Response }).context;
      const payload = res && typeof res.json === 'function' ? await res.json() : null;
      if (payload?.error) message = payload.error;
    } catch {
      // keep the generic message
    }
    throw new CalendarError(message);
  }
  return data as T;
}

export interface RefreshSummary {
  events: number;
  sources: { id: string; ok: boolean; error?: string }[];
}

export async function addCalendar(name: string, feedUrl: string, defaultKind: string | null) {
  const res = await call<{ source: CalendarSource; refresh: RefreshSummary }>({ action: 'add', name, feed_url: feedUrl, default_kind: defaultKind });
  await setMeta(db, LAST_KEY, Date.now());
  return res;
}

export async function replaceCalendarLink(sourceId: string, feedUrl: string) {
  return call<{ refresh: RefreshSummary }>({ action: 'set_feed', source_id: sourceId, feed_url: feedUrl });
}

export async function refreshCalendars(): Promise<RefreshSummary> {
  const res = await call<{ refresh: RefreshSummary }>({ action: 'refresh' });
  await setMeta(db, LAST_KEY, Date.now());
  return res.refresh;
}

/** Refresh if there are calendars and the last refresh is stale. Returns true if it ran. */
export async function maybeRefreshCalendars(): Promise<boolean> {
  if (!navigator.onLine || (await db.calendar_sources.count()) === 0) return false;
  const last = (await getMeta<number>(db, LAST_KEY)) ?? 0;
  if (Date.now() - last < REFRESH_EVERY_MS) return false;
  await setMeta(db, LAST_KEY, Date.now()); // claim it, so overlapping triggers don't double up
  try {
    await refreshCalendars();
    return true;
  } catch {
    return false; // errors are recorded per calendar on the server and shown in Settings
  }
}
