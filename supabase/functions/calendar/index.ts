/**
 * Supabase Edge Function: calendar import.
 *
 * Security:
 * - The caller's JWT is verified with Supabase Auth; all normal reads/writes use
 *   a client acting AS that user, so Row Level Security applies.
 * - The service-role client is used for exactly one thing: the
 *   calendar_feed_secrets table (no browser access), always filtered by the
 *   verified user id. It never leaves this function.
 * - Feed URLs and event contents are never logged.
 */
import { createClient } from '@supabase/supabase-js';
import { handle, MAX_FEED_BYTES, UserError, type Deps } from './handler.ts';

// Provided automatically by Supabase to every Edge Function.
const env = (...names: string[]) => names.map((n) => Deno.env.get(n)).find((v) => v) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const ANON_KEY = env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY');
const MISSING = [['SUPABASE_URL', SUPABASE_URL], ['SUPABASE_ANON_KEY', ANON_KEY], ['SUPABASE_SERVICE_ROLE_KEY', SERVICE_KEY]]
  .filter(([, v]) => !v)
  .map(([n]) => n);
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';
const FETCH_TIMEOUT_MS = 15_000;

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

async function fetchFeed(url: string): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    headers: { Accept: 'text/calendar, text/plain;q=0.8' },
    redirect: 'follow',
  });
  if (!res.ok) throw new UserError(res.status === 404 || res.status === 401 || res.status === 403
    ? 'The calendar link no longer works. It may have been reset.'
    : 'The calendar service didn’t respond properly.');
  const declared = Number(res.headers.get('content-length') ?? 0);
  if (declared > MAX_FEED_BYTES) throw new UserError('That calendar is too large to import.');
  const reader = res.body!.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_FEED_BYTES) {
      await reader.cancel();
      throw new UserError('That calendar is too large to import.');
    }
    chunks.push(value);
  }
  const all = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    all.set(c, offset);
    offset += c.length;
  }
  return new TextDecoder().decode(all);
}

function depsFor(token: string): Deps {
  const user = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const check = <T>(r: { data: T; error: unknown }) => {
    if (r.error) throw new Error('Database request failed');
    return r.data;
  };

  return {
    async userId() {
      const { data, error } = await user.auth.getUser(token);
      return error ? null : (data.user?.id ?? null);
    },
    async listSources() {
      return check(await user.from('calendar_sources').select('id, name, enabled')) ?? [];
    },
    async createSource(name, default_kind) {
      const source = check(await user.from('calendar_sources').insert({ name, default_kind }).select('id, name, enabled').single());
      if (!source) throw new Error('Calendar could not be created');
      return source;
    },
    async deleteSource(id) {
      check(await user.from('calendar_sources').delete().eq('id', id));
    },
    async setFeedUrl(userId, source_id, feed_url) {
      check(await admin.from('calendar_feed_secrets').upsert({ source_id, user_id: userId, feed_url }, { onConflict: 'source_id' }));
    },
    async getFeedUrls(userId) {
      const rows = check(await admin.from('calendar_feed_secrets').select('source_id, feed_url').eq('user_id', userId)) ?? [];
      return new Map(rows.map((r: { source_id: string; feed_url: string }) => [r.source_id, r.feed_url]));
    },
    async existingEvents() {
      return check(await user.from('calendar_events').select('event_key, source_ids, starts_at, end_date')) ?? [];
    },
    async upsertEvents(rows) {
      for (let i = 0; i < rows.length; i += 500) {
        check(await user.from('calendar_events').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,event_key' }));
      }
    },
    async deleteEvents(keys) {
      for (let i = 0; i < keys.length; i += 100) {
        check(await user.from('calendar_events').delete().in('event_key', keys.slice(i, i + 100)));
      }
    },
    async pruneBefore(iso, date) {
      check(await user.from('calendar_events').delete().lt('ends_at', iso));
      check(await user.from('calendar_events').delete().lt('end_date', date));
    },
    async setSourceStatus(id, status) {
      check(await user.from('calendar_sources').update(status).eq('id', id));
    },
    fetchFeed,
    now: () => new Date(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' });
  if (MISSING.length) {
    console.error('calendar function missing configuration:', MISSING.join(', '));
    return json(500, { error: `The calendar function is missing configuration (${MISSING.join(', ')}).` });
  }
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'Not signed in.' });
  try {
    const body = await req.json().catch(() => ({}));
    return json(200, await handle(depsFor(token), body));
  } catch (e) {
    if (e instanceof UserError) return json(e.status, { error: e.message });
    console.error('calendar function failed:', e instanceof Error ? e.name : 'unknown');
    return json(500, { error: 'Something went wrong importing calendars.' });
  }
});
