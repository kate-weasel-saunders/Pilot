import Dexie, { type Table } from 'dexie';
import type { CheckIn, OutboxEntry, Period, Tag } from './types';

/**
 * On-device store (IndexedDB). The UI reads exclusively from here, so it works
 * offline and renders instantly. The server is the durable copy; the outbox
 * holds changes that haven't reached it yet. Cleared on sign-out.
 */
export class SignalDB extends Dexie {
  check_ins!: Table<CheckIn, string>;
  periods!: Table<Period, string>;
  tags!: Table<Tag, string>;
  outbox!: Table<OutboxEntry, string>;
  meta!: Table<{ key: string; value: unknown }, string>;

  constructor(name = 'signal') {
    super(name);
    this.version(1).stores({
      check_ins: 'id, observed_at, local_date, updated_at',
      periods: 'id, start_date',
      tags: 'id, kind',
      outbox: 'key, queued_at',
      meta: 'key',
    });
  }
}

export const db = new SignalDB();

export async function getMeta<T>(d: SignalDB, key: string): Promise<T | undefined> {
  return (await d.meta.get(key))?.value as T | undefined;
}

export async function setMeta(d: SignalDB, key: string, value: unknown): Promise<void> {
  await d.meta.put({ key, value });
}

/** Wipe everything on this device (used on sign-out / account switch). */
export async function clearLocal(d: SignalDB): Promise<void> {
  await d.transaction('rw', [d.check_ins, d.periods, d.tags, d.outbox, d.meta], async () => {
    await Promise.all([d.check_ins.clear(), d.periods.clear(), d.tags.clear(), d.outbox.clear(), d.meta.clear()]);
  });
}
