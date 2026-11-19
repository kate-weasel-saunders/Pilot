/**
 * Calendar import logic, independent of Deno and Supabase so it can be unit
 * tested. index.ts wires it to real clients.
 *
 * Actions (POST JSON, authenticated):
 *   { action: 'add', name, feed_url, default_kind? }  – validate, test, store, import
 *   { action: 'set_feed', source_id, feed_url }        – replace a calendar's link
 *   { action: 'refresh' }                              – re-import all calendars
 *
 * Never logs or returns feed URLs or event contents.
 */
import { importWindow, mergeCalendars, parseFeed, type ImportedEvent } from '../_shared/calendar.ts';

/** Hosts we will fetch from. Keeps the function from being pointed at arbitrary/internal URLs. */
export const ALLOWED_FEED_HOSTS = [
  'calendar.google.com',
  'outlook.office365.com',
  'outlook.office.com',
  'outlook.live.com',
];

export const MAX_FEED_BYTES = 5 * 1024 * 1024;
const PRUNE_AFTER_DAYS = 60;

export interface Source {
  id: string;
  name: string;
  enabled: boolean;
}

export interface ExistingEvent {
  event_key: string;
  source_ids: string[];
  starts_at: string | null;
  end_date: string | null;
}

/** Everything the handler needs from the outside world. */
export interface Deps {
  /** Verified user id for the request's JWT, or null. */
  userId(): Promise<string | null>;
  listSources(): Promise<Source[]>;
  createSource(name: string, defaultKind: string | null): Promise<Source>;
  deleteSource(id: string): Promise<void>;
  /** Server-only secret storage (service role), always scoped by userId. */
  setFeedUrl(userId: string, sourceId: string, url: string): Promise<void>;
  getFeedUrls(userId: string): Promise<Map<string, string>>;
  existingEvents(): Promise<ExistingEvent[]>;
  upsertEvents(rows: ImportedEvent[]): Promise<void>;
  deleteEvents(keys: string[]): Promise<void>;
  pruneBefore(isoInstant: string, isoDate: string): Promise<void>;
  setSourceStatus(id: string, status: { last_refreshed_at?: string; last_error: string | null }): Promise<void>;
  fetchFeed(url: string): Promise<string>;
  now(): Date;
}

export class UserError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Normalise and validate a pasted calendar link. */
export function validateFeedUrl(input: unknown): string {
  if (typeof input !== 'string' || input.length > 2048) throw new UserError('That doesn’t look like a calendar link.');
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^webcals?:\/\//i, 'https://'));
  } catch {
    throw new UserError('That doesn’t look like a calendar link.');
  }
  if (url.protocol !== 'https:') throw new UserError('Calendar links must start with https://');
  if (url.username || url.password || url.port) throw new UserError('That doesn’t look like a calendar link.');
  if (!ALLOWED_FEED_HOSTS.includes(url.hostname.toLowerCase())) {
    throw new UserError('Pilot can import Google Calendar and Outlook/Microsoft 365 calendar links only.');
  }
  return url.toString();
}

function cleanName(input: unknown): string {
  const s = typeof input === 'string' ? input.replace(/\s+/g, ' ').trim().slice(0, 100) : '';
  if (!s) throw new UserError('Give the calendar a name.');
  return s;
}

function cleanKind(input: unknown): string | null {
  if (input == null || input === '') return null;
  if (typeof input !== 'string') throw new UserError('Invalid kind.');
  return input.trim().slice(0, 60) || null;
}

function looksLikeCalendar(text: string): boolean {
  return /BEGIN:VCALENDAR/i.test(text.slice(0, 2000));
}

async function loadFeed(deps: Deps, url: string, sourceId: string, window: ReturnType<typeof importWindow>) {
  const text = await deps.fetchFeed(url);
  if (!looksLikeCalendar(text)) throw new UserError('The link didn’t return a calendar. It may have been reset or made private.');
  try {
    return parseFeed(text, sourceId, window);
  } catch (e) {
    // Name only: parser messages can quote calendar content.
    console.error(`calendar parse failed: ${e instanceof Error ? e.name : 'unknown'}`);
    throw new UserError('The calendar couldn’t be read.');
  }
}

export interface RefreshResult {
  events: number;
  sources: { id: string; ok: boolean; error?: string }[];
}

export async function refresh(deps: Deps, userId: string): Promise<RefreshResult> {
  const now = deps.now();
  const window = importWindow(now);
  const sources = (await deps.listSources()).filter((s) => s.enabled);
  const urls = await deps.getFeedUrls(userId);

  const results = await Promise.all(
    sources.map(async (s) => {
      const url = urls.get(s.id);
      if (!url) return { id: s.id, ok: false as const, error: 'No link saved for this calendar.' };
      try {
        return { id: s.id, ok: true as const, events: await loadFeed(deps, url, s.id, window) };
      } catch (e) {
        return { id: s.id, ok: false as const, error: e instanceof UserError ? e.message : 'Couldn’t reach the calendar.' };
      }
    }),
  );

  const merged = mergeCalendars(results.flatMap((r) => (r.ok ? [r.events] : [])));
  if (merged.length) await deps.upsertEvents(merged);

  // Remove events that vanished from calendars we *successfully* read (or that
  // belong to calendars that no longer exist). A failed fetch deletes nothing.
  const fresh = new Set(merged.map((e) => e.event_key));
  const okIds = new Set(results.filter((r) => r.ok).map((r) => r.id));
  const liveIds = new Set(sources.map((s) => s.id));
  const fromIso = window.from.toISOString();
  const fromDate = fromIso.slice(0, 10);
  const stale = (await deps.existingEvents()).filter((e) => {
    if (fresh.has(e.event_key)) return false;
    const inWindow = e.starts_at ? e.starts_at >= fromIso : (e.end_date ?? '') > fromDate;
    const owners = e.source_ids.filter((id) => liveIds.has(id));
    if (owners.length === 0) return true; // calendar removed
    return inWindow && owners.every((id) => okIds.has(id));
  });
  if (stale.length) await deps.deleteEvents(stale.map((e) => e.event_key));

  const cutoff = new Date(now.getTime() - PRUNE_AFTER_DAYS * 86400000).toISOString();
  await deps.pruneBefore(cutoff, cutoff.slice(0, 10));

  for (const r of results) {
    await deps.setSourceStatus(r.id, r.ok ? { last_refreshed_at: now.toISOString(), last_error: null } : { last_error: r.error ?? null });
  }
  return { events: merged.length, sources: results.map((r) => (r.ok ? { id: r.id, ok: true } : { id: r.id, ok: false, error: r.error })) };
}

/** Route one request body. Returns a JSON-serialisable result or throws UserError. */
export async function handle(deps: Deps, body: unknown): Promise<unknown> {
  const userId = await deps.userId();
  if (!userId) throw new UserError('Not signed in.', 401);
  const b = (body ?? {}) as Record<string, unknown>;

  switch (b.action) {
    case 'add': {
      const name = cleanName(b.name);
      const kind = cleanKind(b.default_kind);
      const url = validateFeedUrl(b.feed_url);
      // Check the link works before saving anything.
      await loadFeed(deps, url, 'probe', importWindow(deps.now()));
      const source = await deps.createSource(name, kind);
      try {
        await deps.setFeedUrl(userId, source.id, url);
      } catch (e) {
        await deps.deleteSource(source.id);
        throw e;
      }
      return { source, refresh: await refresh(deps, userId) };
    }
    case 'set_feed': {
      const url = validateFeedUrl(b.feed_url);
      const id = typeof b.source_id === 'string' ? b.source_id : '';
      if (!(await deps.listSources()).some((s) => s.id === id)) throw new UserError('Calendar not found.', 404);
      await loadFeed(deps, url, id, importWindow(deps.now()));
      await deps.setFeedUrl(userId, id, url);
      return { refresh: await refresh(deps, userId) };
    }
    case 'refresh':
      return { refresh: await refresh(deps, userId) };
    default:
      throw new UserError('Unknown action.');
  }
}
