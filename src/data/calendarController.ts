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
  if (error) throw new CalendarError(await describeFunctionError(error));
  return data as T;
}

/** Turn a supabase-js functions error into something specific enough to act on. */
async function describeFunctionError(error: unknown): Promise<string> {
  const name = (error as Error)?.name ?? '';
  const res = (error as { context?: unknown }).context;
  if (res instanceof Response) {
    let payload: { error?: string } | null = null;
    try {
      payload = await res.clone().json();
    } catch {
      // not JSON
    }
    if (payload?.error) return payload.error;
    if (res.status === 546 || res.status === 504) return `The calendar import took too long and was stopped by the server (HTTP ${res.status}). Try again; if it keeps happening, the calendar may be very large.`;
    return `Pilot’s server returned an unexpected response (HTTP ${res.status}).`;
  }
  if (name === 'FunctionsFetchError') {
    const cause = String((error as { context?: { name?: string } }).context?.name ?? '');
    return cause === 'TimeoutError' || cause === 'AbortError'
      ? 'The calendar import took longer than a minute, so the app stopped waiting. Try again in a moment.'
      : 'Couldn’t reach Pilot’s server. Check your connection and try again.';
  }
  return `Couldn’t reach Pilot’s server (${name || 'unknown error'}). Try again in a moment.`;
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
