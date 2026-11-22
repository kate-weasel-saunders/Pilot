import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { extractLines, handleHealth, sha256Hex, type HealthDeps } from './handler';
import type { HealthSample } from '../_shared/health';

function world() {
  const state = {
    keys: [] as { id: string; user_id: string; key_hash: string; label: string; last_summary?: string }[],
    samples: new Map<string, HealthSample & { user_id: string }>(),
  };
  const deps: HealthDeps = {
    userFromJwt: async (t) => (t === 'jwt-kate' ? 'kate' : t === 'jwt-other' ? 'other' : null),
    countKeys: async (u) => state.keys.filter((k) => k.user_id === u).length,
    insertKey: async (user_id, key_hash, label) => void state.keys.push({ id: `k${state.keys.length + 1}`, user_id, key_hash, label }),
    findKey: async (h) => state.keys.find((k) => k.key_hash === h) ?? null,
    touchKey: async (id, s) => void (state.keys.find((k) => k.id === id)!.last_summary = s),
    upsertSamples: async (user_id, rows) => rows.forEach((r) => state.samples.set(`${user_id}|${r.sample_key}`, { ...r, user_id })),
    overlapping: async (user_id, metric, label, start, end) =>
      [...state.samples.values()].filter((s) => s.user_id === user_id && s.metric === metric && (!label || s.label === label) && s.starts_at <= end && s.ends_at >= start),
    deleteSamples: async (user_id, keys) => keys.forEach((k) => state.samples.delete(`${user_id}|${k}`)),
    pruneShortExercise: async (user_id, min) => {
      for (const [k, s] of state.samples) if (s.user_id === user_id && s.metric === 'workout' && s.label === 'Exercise' && (s.value ?? 0) < min) state.samples.delete(k);
    },
    randomBytes: (n) => new Uint8Array(randomBytes(n)),
    now: () => new Date('2026-11-21T22:00:00Z'),
  };
  return { state, deps };
}

async function createKey(deps: HealthDeps, jwt = 'jwt-kate') {
  const r = await handleHealth(deps, { token: jwt, body: JSON.stringify({ action: 'create_key' }), contentType: 'application/json' });
  return JSON.parse(r.body).key as string;
}

describe('keys', () => {
  it('creates a key, stores only its hash, and returns it once', async () => {
    const { state, deps } = world();
    const key = await createKey(deps);
    expect(key).toMatch(/^pilot_hk_[A-Za-z0-9_-]{43}$/);
    expect(state.keys[0]!.key_hash).toBe(await sha256Hex(key));
    expect(JSON.stringify(state.keys)).not.toContain(key);
  });
  it('requires a signed-in user to create keys', async () => {
    const { deps } = world();
    const r = await handleHealth(deps, { token: 'nonsense', body: '{"action":"create_key"}', contentType: 'application/json' });
    expect(r.status).toBe(401);
  });
  it('limits the number of keys', async () => {
    const { deps } = world();
    for (let i = 0; i < 5; i++) await createKey(deps);
    const r = await handleHealth(deps, { token: 'jwt-kate', body: '{"action":"create_key"}', contentType: 'application/json' });
    expect(r.status).toBe(400);
  });
});

describe('ingest', () => {
  const lines = ['workout|2026-11-21T07:10:00Z|2026-11-21T07:45:00Z|||Running', 'sleep|2026-11-21T01:00:00Z|2026-11-21T03:00:00Z|Core'].join('\n');

  it('accepts plain-text lines with a valid key and replies with a summary', async () => {
    const { state, deps } = world();
    const key = await createKey(deps);
    const r = await handleHealth(deps, { token: key, body: lines, contentType: 'text/plain' });
    expect(r).toEqual({ status: 200, type: 'text', body: 'Pilot received 1 workout, 1 sleep session.' });
    expect([...state.samples.values()].every((s) => s.user_id === 'kate')).toBe(true);
    expect(state.keys[0]!.last_summary).toBe('Pilot received 1 workout, 1 sleep session.');
  });

  it('accepts JSON {"lines": …} as sent by Shortcuts', async () => {
    const { state, deps } = world();
    const key = await createKey(deps);
    await handleHealth(deps, { token: key, body: JSON.stringify({ lines }), contentType: 'application/json' });
    expect(state.samples.size).toBe(2);
  });

  it('is safe to re-send: duplicates collapse and a fuller night replaces a partial one', async () => {
    const { state, deps } = world();
    const key = await createKey(deps);
    await handleHealth(deps, { token: key, body: lines, contentType: 'text/plain' });
    await handleHealth(deps, { token: key, body: lines + '\nsleep|2026-11-20T23:30:00Z|2026-11-21T01:00:00Z|Deep', contentType: 'text/plain' });
    const nights = [...state.samples.values()].filter((s) => s.metric === 'sleep');
    expect(nights).toHaveLength(1);
    expect(nights[0]!.starts_at).toBe('2026-11-20T23:30:00.000Z');
    expect([...state.samples.values()].filter((s) => s.metric === 'workout')).toHaveLength(1);
  });

  it('rejects unknown or revoked keys without storing anything', async () => {
    const { state, deps } = world();
    const r = await handleHealth(deps, { token: 'pilot_hk_notarealkey', body: lines, contentType: 'text/plain' });
    expect(r.status).toBe(401);
    expect(r.body).toMatch(/Settings → Apple Health/);
    expect(state.samples.size).toBe(0);
  });

  it('writes to the key owner only', async () => {
    const { state, deps } = world();
    await createKey(deps, 'jwt-other');
    const key = await createKey(deps, 'jwt-kate');
    await handleHealth(deps, { token: key, body: lines, contentType: 'text/plain' });
    expect([...state.samples.values()].map((s) => s.user_id)).toEqual(['kate', 'kate']);
  });
});

describe('partial re-sends never lose data', () => {
  const night = ['sleep|2026-11-20T23:00:00Z|2026-11-21T03:00:00Z|Core', 'sleep|2026-11-21T03:00:00Z|2026-11-21T06:30:00Z|Deep'];
  it('keeps a full night when a later send only contains its last part', async () => {
    const { state, deps } = world();
    const key = await createKey(deps);
    await handleHealth(deps, { token: key, body: night.join('\n'), contentType: 'text/plain' });
    await handleHealth(deps, { token: key, body: night[1]!, contentType: 'text/plain' });
    const nights = [...state.samples.values()].filter((s) => s.metric === 'sleep');
    expect(nights.map((n) => [n.starts_at, n.value])).toEqual([['2026-11-20T23:00:00.000Z', 450]]);
  });
  it('replaces a partial exercise session with the complete one', async () => {
    const { state, deps } = world();
    const key = await createKey(deps);
    await handleHealth(deps, { token: key, body: 'Exercise Minutes|2026-11-21T07:20:00Z|2026-11-21T07:32:00Z|12|min', contentType: 'text/plain' });
    await handleHealth(deps, {
      token: key,
      body: 'Exercise Minutes|2026-11-21T07:10:00Z|2026-11-21T07:20:00Z|10|min\nExercise Minutes|2026-11-21T07:20:00Z|2026-11-21T07:35:00Z|15|min',
      contentType: 'text/plain',
    });
    const sessions = [...state.samples.values()].filter((s) => s.metric === 'workout');
    expect(sessions.map((w) => [w.starts_at, w.value])).toEqual([['2026-11-21T07:10:00.000Z', 25]]);
  });
  it('drops short bursts and cleans up any stored before the minimum existed', async () => {
    const { state, deps } = world();
    const key = await createKey(deps);
    state.samples.set('kate|workout|exercise|old', { metric: 'workout', label: 'Exercise', value: 3, starts_at: '2026-11-20T09:00:00.000Z', ends_at: '2026-11-20T09:03:00.000Z', unit: 'min', detail: {}, sample_key: 'workout|exercise|old', user_id: 'kate' });
    await handleHealth(deps, { token: key, body: 'Exercise Minutes|2026-11-21T12:00:00Z|2026-11-21T12:04:00Z|4|min', contentType: 'text/plain' });
    expect([...state.samples.values()].filter((s) => s.metric === 'workout')).toEqual([]);
  });
});

describe('extractLines', () => {
  it('handles text, JSON string and JSON list bodies', () => {
    expect(extractLines('a\nb', 'text/plain')).toBe('a\nb');
    expect(extractLines('{"lines":"a\\nb"}', 'application/json')).toBe('a\nb');
    expect(extractLines('{"lines":["a","b"]}', 'application/json')).toBe('a\nb');
    expect(extractLines('["a","b"]', '')).toBe('a\nb');
    expect(extractLines('{"Lines":"a\\nb"}', 'application/json')).toBe('a\nb');
    expect(extractLines('{" LINES ":["a"]}', 'application/json')).toBe('a');
  });
});
