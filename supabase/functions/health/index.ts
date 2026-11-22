/**
 * Supabase Edge Function: Apple Health import.
 *
 * Deployed with --no-verify-jwt, because the iOS Shortcut has no Supabase
 * login. Every request is authenticated here instead:
 * - Shortcut: an ingest key (only its SHA-256 hash is stored), which maps to
 *   exactly one user; all writes are scoped to that user.
 * - App: the user's Supabase JWT, verified with Supabase Auth.
 * The service-role client never leaves this function. Health values and keys
 * are never logged.
 */
import { createClient } from '@supabase/supabase-js';
import { handleHealth, MAX_BODY_BYTES, type HealthDeps } from './handler.ts';

const env = (...names: string[]) => names.map((n) => Deno.env.get(n)).find((v) => v) ?? '';
const SUPABASE_URL = env('SUPABASE_URL');
const ANON_KEY = env('SUPABASE_ANON_KEY', 'SUPABASE_PUBLISHABLE_KEY');
const SERVICE_KEY = env('SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_SECRET_KEY');
const ALLOWED_ORIGIN = Deno.env.get('ALLOWED_ORIGIN') ?? '*';

const cors = {
  'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  Vary: 'Origin',
};

class DbError extends Error {
  constructor(readonly stage: string, readonly code: string) {
    super(`database error at ${stage} (${code})`);
  }
}

function deps(): HealthDeps {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const check = <T>(stage: string, r: { data: T; error: unknown }) => {
    if (r.error) throw new DbError(stage, String((r.error as { code?: string }).code || 'unknown'));
    return r.data;
  };
  return {
    async userFromJwt(token) {
      const anon = createClient(SUPABASE_URL, ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
      const { data, error } = await anon.auth.getUser(token);
      return error ? null : (data.user?.id ?? null);
    },
    async countKeys(userId) {
      const r = await admin.from('health_ingest_keys').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      check('countKeys', r);
      return r.count ?? 0;
    },
    async insertKey(user_id, key_hash, label) {
      check('insertKey', await admin.from('health_ingest_keys').insert({ user_id, key_hash, label }));
    },
    async findKey(hash) {
      return check('findKey', await admin.from('health_ingest_keys').select('id, user_id').eq('key_hash', hash).maybeSingle());
    },
    async touchKey(id, last_summary) {
      check('touchKey', await admin.from('health_ingest_keys').update({ last_used_at: new Date().toISOString(), last_summary }).eq('id', id));
    },
    async upsertSamples(user_id, samples) {
      const rows = samples.map((s) => ({ ...s, user_id }));
      for (let i = 0; i < rows.length; i += 500) {
        check('upsertSamples', await admin.from('health_samples').upsert(rows.slice(i, i + 500), { onConflict: 'user_id,sample_key' }));
      }
    },
    async overlapping(user_id, metric, label, start, end) {
      let q = admin.from('health_samples').select('sample_key, starts_at, ends_at, value').eq('user_id', user_id).eq('metric', metric).lte('starts_at', end).gte('ends_at', start);
      if (label) q = q.eq('label', label);
      // Normalise timestamps so they compare as strings with the parser's ISO output.
      return (check('overlapping', await q) ?? []).map((r: { sample_key: string; starts_at: string; ends_at: string; value: number | null }) => ({
        ...r,
        starts_at: new Date(r.starts_at).toISOString(),
        ends_at: new Date(r.ends_at).toISOString(),
        value: r.value === null ? null : Number(r.value),
      }));
    },
    async pruneShortExercise(user_id, minMinutes) {
      check('pruneShortExercise', await admin.from('health_samples').delete().eq('user_id', user_id).eq('metric', 'workout').eq('label', 'Exercise').lt('value', minMinutes));
    },
    async deleteSamples(user_id, keys) {
      for (let i = 0; i < keys.length; i += 100) {
        check('deleteSamples', await admin.from('health_samples').delete().eq('user_id', user_id).in('sample_key', keys.slice(i, i + 100)));
      }
    },
    randomBytes: (n) => crypto.getRandomValues(new Uint8Array(n)),
    now: () => new Date(),
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return new Response('Send a POST request.', { status: 405, headers: cors });
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    console.error('health function missing configuration');
    return new Response('The health function is missing configuration.', { status: 500, headers: cors });
  }
  if (Number(req.headers.get('content-length') ?? 0) > MAX_BODY_BYTES) {
    return new Response('Too much data in one go. Send fewer days at a time.', { status: 413, headers: cors });
  }
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '').trim() || null;
  try {
    const r = await handleHealth(deps(), { token, body: await req.text(), contentType: req.headers.get('content-type') ?? '' });
    return new Response(r.body, {
      status: r.status,
      headers: { ...cors, 'Content-Type': r.type === 'json' ? 'application/json' : 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    const detail = e instanceof DbError ? `${e.stage}, code ${e.code}` : e instanceof Error ? e.name : 'unknown';
    console.error(`health function failed: ${detail}`);
    return new Response(`Pilot couldn’t save the health data (${detail}).`, { status: 500, headers: cors });
  }
});
