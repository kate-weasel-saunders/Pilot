import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PilotDB } from './db';
import { deleteRow, newId, saveRow } from './repo';
import { pull, push, type Remote } from './sync';
import type { CheckIn, PulledTable } from './types';

type Row = { id: string; updated_at: string } & Record<string, unknown>;

/** In-memory stand-in for Supabase. `offline` makes every call fail. */
class FakeRemote implements Remote {
  tables: Record<PulledTable, Map<string, Row>> = {
    check_ins: new Map(), periods: new Map(), tags: new Map(), calendar_sources: new Map(), event_series: new Map(), calendar_events: new Map(),
  };
  offline = false;
  clock = Date.parse('2026-11-18T10:00:00Z');
  beforeUpsert?: () => Promise<void>;
  private tick() {
    this.clock += 1000;
    return new Date(this.clock).toISOString();
  }
  private check() {
    if (this.offline) throw new TypeError('Failed to fetch');
  }
  async upsert(table: PulledTable, rows: Row[]) {
    this.check();
    await this.beforeUpsert?.();
    return rows.map((r) => {
      const saved = { ...r, updated_at: this.tick() };
      this.tables[table].set(r.id, saved);
      return saved;
    });
  }
  async remove(table: PulledTable, ids: string[]) {
    this.check();
    ids.forEach((id) => this.tables[table].delete(id));
  }
  async pullSince(table: PulledTable, cursor: string | null) {
    this.check();
    return [...this.tables[table].values()].filter((r) => !cursor || r.updated_at > cursor);
  }
  async listIds(table: PulledTable) {
    this.check();
    return [...this.tables[table].keys()];
  }
}

const checkIn = (over: Partial<CheckIn> = {}): CheckIn => ({
  id: newId(), observed_at: '2026-11-18T09:00:00.000Z', timezone: 'Europe/London', local_date: '2026-11-18',
  local_time: '09:00:00', mood: 3, energy: 2, anxiety: null, pressure: 4, body_tags: ['Heavy'], context_tags: ['Work'],
  need_tags: [], thought: 'Can’t face this meeting.', preceding: null, events: [], extra: {}, created_at: '', updated_at: '', ...over,
});

let d: PilotDB;
let remote: FakeRemote;
beforeEach(() => {
  d = new PilotDB(`test-${Math.random()}`);
  remote = new FakeRemote();
});
afterEach(async () => {
  await d.delete();
});

describe('local-first writes', () => {
  it('keeps a check-in and its outbox entry when offline', async () => {
    remote.offline = true;
    const c = await saveRow(d, 'check_ins', checkIn());
    await expect(push(d, remote)).rejects.toThrow();
    expect(await d.check_ins.get(c.id)).toBeTruthy();
    expect(await d.outbox.count()).toBe(1);

    remote.offline = false;
    await push(d, remote);
    expect(await d.outbox.count()).toBe(0);
    expect(remote.tables.check_ins.get(c.id)?.thought).toBe('Can’t face this meeting.');
  });

  it('adopts server timestamps after a push', async () => {
    const c = await saveRow(d, 'check_ins', checkIn());
    await push(d, remote);
    expect((await d.check_ins.get(c.id))?.updated_at).toBe(remote.tables.check_ins.get(c.id)?.updated_at);
  });

  it('does not lose an edit made while a push is in flight', async () => {
    const c = await saveRow(d, 'check_ins', checkIn({ thought: 'first' }));
    remote.beforeUpsert = async () => {
      remote.beforeUpsert = undefined;
      await saveRow(d, 'check_ins', { ...c, thought: 'second' });
    };
    await push(d, remote);
    expect((await d.check_ins.get(c.id))?.thought).toBe('second');
    expect(await d.outbox.count()).toBe(1); // still queued
    await push(d, remote);
    expect(remote.tables.check_ins.get(c.id)?.thought).toBe('second');
  });

  it('pushes deletions', async () => {
    const c = await saveRow(d, 'check_ins', checkIn());
    await push(d, remote);
    await deleteRow(d, 'check_ins', c.id);
    expect(await d.check_ins.get(c.id)).toBeUndefined();
    await push(d, remote);
    expect(remote.tables.check_ins.has(c.id)).toBe(false);
    expect(await d.outbox.count()).toBe(0);
  });
});

describe('pull', () => {
  it('brings in rows from other devices and removes rows deleted elsewhere', async () => {
    const mine = await saveRow(d, 'check_ins', checkIn());
    await push(d, remote);
    const other = checkIn({ thought: 'from laptop' });
    await remote.upsert('check_ins', [other as unknown as Row]);
    remote.tables.check_ins.delete(mine.id); // deleted on another device

    await pull(d, remote);
    expect((await d.check_ins.get(other.id))?.thought).toBe('from laptop');
    expect(await d.check_ins.get(mine.id)).toBeUndefined();
  });

  it('never overwrites or deletes a row with unsynced local changes', async () => {
    const c = await saveRow(d, 'check_ins', checkIn({ thought: 'server version' }));
    await push(d, remote);
    await saveRow(d, 'check_ins', { ...c, thought: 'local edit, not yet pushed' });
    const fresh = await saveRow(d, 'check_ins', checkIn({ thought: 'brand new, offline' }));
    remote.tables.check_ins.set(c.id, { ...remote.tables.check_ins.get(c.id)!, thought: 'changed remotely', updated_at: '2030-01-01T00:00:00Z' });

    await pull(d, remote);
    expect((await d.check_ins.get(c.id))?.thought).toBe('local edit, not yet pushed');
    expect(await d.check_ins.get(fresh.id)).toBeTruthy();
  });

  it('pulls incrementally using a cursor', async () => {
    await remote.upsert('check_ins', [checkIn() as unknown as Row]);
    await pull(d, remote);
    const cursor = (await d.meta.get('cursor:check_ins'))?.value;
    expect(cursor).toBeTruthy();
    await remote.upsert('check_ins', [checkIn() as unknown as Row]);
    await pull(d, remote);
    expect(await d.check_ins.count()).toBe(2);
  });
});
