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
  /** Delete this user's sleep sessions overlapping [start, end] except the given keys (re-sent nights replace partial ones). */
  replaceOverlappingSleep(userId: string, start: string, end: string, keep: string[]): Promise<void>;
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

export async function handleHealth(deps: HealthDeps, req: { token: string | null; body: string; contentType: string }): Promise<Reply> {
  const token = req.token ?? '';

  // --- Shortcut ingest -------------------------------------------------------
  if (token.startsWith(KEY_PREFIX)) {
    const key = await deps.findKey(await sha256Hex(token));
    if (!key) return text(401, 'This Pilot key isn’t valid any more. Create a new one in Pilot → Settings → Apple Health and paste it into the Shortcut.');
    if (req.body.length > MAX_BODY_BYTES) return text(413, 'Too much data in one go. Send fewer days at a time.');
    const result = parseLines(extractLines(req.body, req.contentType), deps.now());
    if (result.samples.length) {
      for (const night of result.samples.filter((s) => s.metric === 'sleep')) {
        await deps.replaceOverlappingSleep(key.user_id, night.starts_at, night.ends_at, [night.sample_key]);
      }
      await deps.upsertSamples(key.user_id, result.samples);
    }
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
