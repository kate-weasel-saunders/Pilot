import type { PilotDB } from './db';
import type { CheckIn, OutboxEntry, Period, SyncedTable, Tag } from './types';

/**
 * Local writes. Every change lands in IndexedDB and the outbox in a single
 * transaction, so nothing the user saves can be lost to a dropped connection.
 * Pushing to the server happens separately (see sync.ts).
 */

type RowFor<T extends SyncedTable> = T extends 'check_ins' ? CheckIn : T extends 'periods' ? Period : Tag;

let lastQueued = 0;
/** Strictly increasing ms timestamp, so re-queues are always detectable. */
function nextQueuedAt(): number {
  lastQueued = Math.max(Date.now(), lastQueued + 1);
  return lastQueued;
}

export const newId = (): string => crypto.randomUUID();

const outboxEntry = (table: SyncedTable, id: string, op: OutboxEntry['op']): OutboxEntry => ({
  key: `${table}:${id}`,
  table,
  id,
  op,
  queued_at: nextQueuedAt(),
});

export async function saveRow<T extends SyncedTable>(d: PilotDB, table: T, row: RowFor<T>): Promise<RowFor<T>> {
  const now = new Date().toISOString();
  const t = d.table(table);
  const saved = await d.transaction('rw', t, d.outbox, async () => {
    const existing = (await t.get(row.id)) as RowFor<T> | undefined;
    const next = { ...row, created_at: existing?.created_at ?? row.created_at ?? now, updated_at: now };
    await t.put(next);
    await d.outbox.put(outboxEntry(table, row.id, 'upsert'));
    return next;
  });
  return saved as RowFor<T>;
}

export async function deleteRow(d: PilotDB, table: SyncedTable, id: string): Promise<void> {
  const t = d.table(table);
  await d.transaction('rw', t, d.outbox, async () => {
    await t.delete(id);
    await d.outbox.put(outboxEntry(table, id, 'delete'));
  });
}
