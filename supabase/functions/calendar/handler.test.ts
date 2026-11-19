import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { handle, UserError, validateFeedUrl, type Deps, type ExistingEvent, type Source } from './handler';
import type { ImportedEvent } from '../_shared/calendar';

const fixture = (n: string) => readFileSync(join(__dirname, '..', '_shared', 'fixtures', n), 'utf8');
const GOOGLE = 'https://calendar.google.com/calendar/ical/abc%40group.calendar.google.com/private-xyz/basic.ics';
const OUTLOOK = 'https://outlook.office365.com/owa/calendar/abc/def/calendar.ics';

/** In-memory world: sources, secrets, events, and feeds by URL. */
function world(feeds: Record<string, string | Error>) {
  const state = {
    user: 'user-1' as string | null,
    sources: [] as (Source & { last_error?: string | null; last_refreshed_at?: string })[],
    secrets: new Map<string, { userId: string; url: string }>(),
    events: new Map<string, ImportedEvent>(),
    fetched: [] as string[],
  };
  let n = 0;
  const deps: Deps = {
    userId: async () => state.user,
    listSources: async () => state.sources.map(({ id, name, enabled }) => ({ id, name, enabled })),
    createSource: async (name) => {
      const s = { id: `src-${++n}`, name, enabled: true };
      state.sources.push(s);
      return s;
    },
    deleteSource: async (id) => {
      state.sources = state.sources.filter((s) => s.id !== id);
    },
    setFeedUrl: async (userId, id, url) => void state.secrets.set(id, { userId, url }),
    getFeedUrls: async (userId) => new Map([...state.secrets].filter(([, v]) => v.userId === userId).map(([k, v]) => [k, v.url])),
    existingEvents: async () =>
      [...state.events.values()].map((e): ExistingEvent => ({ event_key: e.event_key, source_ids: e.source_ids, starts_at: e.starts_at, end_date: e.end_date })),
    upsertEvents: async (rows) => rows.forEach((r) => state.events.set(r.event_key, r)),
    deleteEvents: async (keys) => keys.forEach((k) => state.events.delete(k)),
    pruneBefore: async () => {},
    setSourceStatus: async (id, status) => {
      Object.assign(state.sources.find((s) => s.id === id)!, status);
    },
    fetchFeed: async (url) => {
      state.fetched.push(url);
      const f = feeds[url];
      if (f instanceof Error) throw f;
      if (f === undefined) throw new UserError('The calendar link no longer works. It may have been reset.');
      return f;
    },
    now: () => new Date('2026-11-19T12:00:00Z'),
  };
  return { state, deps };
}

describe('validateFeedUrl', () => {
  it('accepts Google and Outlook links, upgrading webcal://', () => {
    expect(validateFeedUrl(GOOGLE)).toBe(GOOGLE);
    expect(validateFeedUrl(OUTLOOK.replace('https', 'webcal'))).toBe(OUTLOOK);
  });
  it.each([
    'http://calendar.google.com/x.ics',
    'https://evil.example.com/x.ics',
    'https://169.254.169.254/latest/meta-data',
    'https://calendar.google.com.evil.com/x.ics',
    'https://user:pw@calendar.google.com/x.ics',
    'not a url',
    42,
  ])('rejects %s', (u) => {
    expect(() => validateFeedUrl(u)).toThrow(UserError);
  });
});

describe('handle', () => {
  it('requires a signed-in user', async () => {
    const { state, deps } = world({});
    state.user = null;
    await expect(handle(deps, { action: 'refresh' })).rejects.toMatchObject({ status: 401 });
  });

  it('adds a calendar: tests the link, stores the secret, imports events', async () => {
    const { state, deps } = world({ [GOOGLE]: fixture('google.ics') });
    const res = (await handle(deps, { action: 'add', name: ' Kate & Neil ', feed_url: GOOGLE, default_kind: 'Family' })) as { source: Source };
    expect(res.source.name).toBe('Kate & Neil');
    expect(state.secrets.get(res.source.id)).toEqual({ userId: 'user-1', url: GOOGLE });
    expect([...state.events.values()].some((e) => e.title === 'Dentist')).toBe(true);
    expect(state.sources[0]!.last_error).toBeNull();
  });

  it('fetches a newly added calendar only once', async () => {
    const { state, deps } = world({ [GOOGLE]: fixture('google.ics') });
    await handle(deps, { action: 'add', name: 'Home', feed_url: GOOGLE });
    expect(state.fetched).toEqual([GOOGLE]);
  });

  it('refuses a link that does not return a calendar, saving nothing', async () => {
    const { state, deps } = world({ [GOOGLE]: '<html>Sign in</html>' });
    await expect(handle(deps, { action: 'add', name: 'X', feed_url: GOOGLE })).rejects.toThrow(/didn’t return a calendar/);
    expect(state.sources).toHaveLength(0);
    expect(state.secrets.size).toBe(0);
  });

  it('merges duplicates across calendars', async () => {
    const SECOND = GOOGLE.replace('private-xyz', 'private-second');
    const { state, deps } = world({ [GOOGLE]: fixture('google.ics'), [SECOND]: fixture('google-second.ics') });
    await handle(deps, { action: 'add', name: 'One', feed_url: GOOGLE });
    await handle(deps, { action: 'add', name: 'Two', feed_url: SECOND });
    const dentists = [...state.events.values()].filter((e) => e.title === 'Dentist');
    expect(dentists).toHaveLength(1);
    expect(dentists[0]!.source_ids.sort()).toEqual(['src-1', 'src-2']);
  });

  it('does not delete events when a calendar fails to load, and records a readable error', async () => {
    const feeds: Record<string, string | Error> = { [GOOGLE]: fixture('google.ics') };
    const { state, deps } = world(feeds);
    await handle(deps, { action: 'add', name: 'Home', feed_url: GOOGLE });
    const before = state.events.size;
    feeds[GOOGLE] = new TypeError('network down');
    const res = (await handle(deps, { action: 'refresh' })) as { refresh: { sources: { ok: boolean; error?: string }[] } };
    expect(res.refresh.sources[0]).toEqual({ id: 'src-1', ok: false, error: 'Couldn’t reach the calendar.' });
    expect(state.events.size).toBe(before);
    expect(state.sources[0]!.last_error).toBe('Couldn’t reach the calendar.');
  });

  it('removes events that disappeared from a calendar, and all events of a removed calendar', async () => {
    const feeds: Record<string, string | Error> = { [GOOGLE]: fixture('google.ics') };
    const { state, deps } = world(feeds);
    await handle(deps, { action: 'add', name: 'Home', feed_url: GOOGLE });
    feeds[GOOGLE] = fixture('google.ics').replace(/BEGIN:VEVENT\r?\nDTSTART;TZID=Europe\/London:20261120T100000[\s\S]*?END:VEVENT\r?\n/, '');
    await handle(deps, { action: 'refresh' });
    expect([...state.events.values()].some((e) => e.title === 'Dentist')).toBe(false);
    expect(state.events.size).toBeGreaterThan(0);
    state.sources = [];
    await handle(deps, { action: 'refresh' });
    expect(state.events.size).toBe(0);
  });

  it('only reads secrets belonging to the caller', async () => {
    const { state, deps } = world({ [GOOGLE]: fixture('google.ics') });
    state.sources.push({ id: 'theirs', name: 'Theirs', enabled: true });
    state.secrets.set('theirs', { userId: 'someone-else', url: GOOGLE });
    await handle(deps, { action: 'refresh' });
    expect(state.fetched).toHaveLength(0);
  });

  it('rejects unknown actions and bad input', async () => {
    const { deps } = world({});
    await expect(handle(deps, { action: 'drop_tables' })).rejects.toThrow('Unknown action.');
    await expect(handle(deps, { action: 'add', name: '', feed_url: GOOGLE })).rejects.toThrow('Give the calendar a name.');
  });
});
