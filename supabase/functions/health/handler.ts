/**
 * Apple Health import logic, independent of Deno/Supabase for testing.
 *
 * Two kinds of caller:
 * - The iOS Shortcut: `Authorization: Bearer pilot_hk_…` (an ingest key) and
 *   a body of lines (plain text, or JSON {"lines": "…"}). Replies in plain text
 *   so the Shortcut can show it.
 * - The Pilot app (signed in): JSON {"action": "create_key", "label"?}. Returns
 *   the new key once; only its SHA-256 hash is stored.
 */
import { parseLines, summarise, type HealthSample } from '../_shared/health.ts';

export const KEY_PREFIX = 'pilot_hk_';
export const MAX_KEYS = 5;
export const MAX_BODY_BYTES = 1024 * 1024;

export interface HealthDeps {
  userFromJwt(token: string): Promise<string | null>;
  countKeys(userId: string): Promise<number>;
  insertKey(userId: string, hash: string, label: string): Promise<void>;
  findKey(hash: string): Promise<{ id: string; user_id: string } | null>;
  touchKey(id: string, summary: string): Promise<void>;
  upsertSamples(userId: string, samples: HealthSample[]): Promise<void>;
  /** This user's stored sessions of `metric` (and `label`, if given) overlapping [start, end]. */
  overlapping(userId: string, metric: string, label: string | null, start: string, end: string): Promise<{ sample_key: string; starts_at: string; ends_at: string; value: number | null }[]>;
  deleteSamples(userId: string, keys: string[]): Promise<void>;
  randomBytes(n: number): Uint8Array;
  now(): Date;
}

export interface Reply {
  status: number;
  body: string;
  type: 'text' | 'json';
}

const text = (status: number, body: string): Reply => ({ status, body, type: 'text' });
const json = (status: number, body: unknown): Reply => ({ status, body: JSON.stringify(body), type: 'json' });

export async function sha256Hex(s: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function base64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Pull the lines out of whatever the Shortcut sent. */
export function extractLines(body: string, contentType: string): string {
  const looksJson = contentType.includes('json') || /^\s*[{[]/.test(body);
  if (!looksJson) return body;
  try {
    const parsed = JSON.parse(body) as unknown;
    if (Array.isArray(parsed)) return parsed.map(String).join('\n');
    const lines = (parsed as { lines?: unknown }).lines;
    if (Array.isArray(lines)) return lines.map(String).join('\n');
    if (typeof lines === 'string') return lines;
    return '';
  } catch {
    return body;
  }
}

/** Sessions Pilot builds from many readings: a re-send may see more or less of them than last time. */
const isSession = (s: HealthSample) => s.metric === 'sleep' || (s.metric === 'workout' && s.label === 'Exercise');

/**
 * For condensed sessions (nights of sleep, exercise sessions): if a stored
 * session already covers the new one at least as fully, keep the stored one;
 * otherwise the new one replaces any overlapping, smaller stored sessions.
 * So re-sending the same data — or only part of it — never loses anything.
 */
export async function reconcileSessions(deps: HealthDeps, userId: string, samples: HealthSample[]): Promise<HealthSample[]> {
  const out: HealthSample[] = [];
  for (const s of samples) {
    if (!isSession(s)) {
      out.push(s);
      continue;
    }
    const others = (await deps.overlapping(userId, s.metric, s.metric === 'workout' ? 'Exercise' : null, s.starts_at, s.ends_at)).filter(
      (o) => o.sample_key !== s.sample_key,
    );
    const covered = others.some((o) => o.starts_at <= s.starts_at && o.ends_at >= s.ends_at && (o.value ?? 0) >= (s.value ?? 0));
    if (covered) continue;
    if (others.length) await deps.deleteSamples(userId, others.map((o) => o.sample_key));
    out.push(s);
  }
  return out;
}

export async function handleHealth(deps: HealthDeps, req: { token: string | null; body: string; contentType: string }): Promise<Reply> {
  const token = req.token ?? '';

  // --- Shortcut ingest -------------------------------------------------------
  if (token.startsWith(KEY_PREFIX)) {
    const key = await deps.findKey(await sha256Hex(token));
    if (!key) return text(401, 'This Pilot key isn’t valid any more. Create a new one in Pilot → Settings → Apple Health and paste it into the Shortcut.');
    if (req.body.length > MAX_BODY_BYTES) return text(413, 'Too much data in one go. Send fewer days at a time.');
    const result = parseLines(extractLines(req.body, req.contentType), deps.now());
    const toSave = await reconcileSessions(deps, key.user_id, result.samples);
    if (toSave.length) await deps.upsertSamples(key.user_id, toSave);
    const summary = summarise(result);
    await deps.touchKey(key.id, summary);
    return text(200, summary);
  }

  // --- App actions (signed in) -----------------------------------------------
  const userId = token ? await deps.userFromJwt(token) : null;
  if (!userId) return json(401, { error: 'Not signed in.' });
  let body: { action?: unknown; label?: unknown } = {};
  try {
    body = JSON.parse(req.body || '{}');
  } catch {
    return json(400, { error: 'Invalid request.' });
  }
  if (body.action !== 'create_key') return json(400, { error: 'Unknown action.' });
  if ((await deps.countKeys(userId)) >= MAX_KEYS) return json(400, { error: `You already have ${MAX_KEYS} keys. Revoke one you no longer use first.` });
  const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim().slice(0, 60) : 'Shortcut';
  const key = KEY_PREFIX + base64url(deps.randomBytes(32));
  await deps.insertKey(userId, await sha256Hex(key), label);
  return json(200, { key, label });
}
