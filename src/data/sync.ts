import type { SupabaseClient } from '@supabase/supabase-js';
import { getMeta, setMeta, type PilotDB } from './db';
import type { SyncedTable } from './types';

/**
 * Deliberately simple sync for a single person on a few devices:
 *
 * push: send every outbox entry (batched per table). Upserts are idempotent
 *       because IDs are generated on the device. An entry is only cleared if
 *       it wasn't re-queued while the request was in flight.
 * pull: fetch rows changed since a cursor (server updated_at, with an overlap
 *       margin), skipping rows that have local pending changes; then compare
 *       ID lists to notice rows deleted on another device.
 *
 * Conflicts: last write to reach the server wins. Acceptable for one user.
 */

export const SYNCED_TABLES: SyncedTable[] = ['check_ins', 'periods', 'tags'];

type Row = { id: string; updated_at: string } & Record<string, unknown>;

export interface Remote {
  upsert(table: SyncedTable, rows: Row[]): Promise<Row[]>;
  remove(table: SyncedTable, ids: string[]): Promise<void>;
  pullSince(table: SyncedTable, cursor: string | null): Promise<Row[]>;
  listIds(table: SyncedTable): Promise<string[]>;
}

/** Overlap when pulling, to tolerate transactions committing out of order. */
const CURSOR_OVERLAP_MS = 5 * 60 * 1000;

export async function push(d: PilotDB, remote: Remote): Promise<number> {
  const entries = await d.outbox.orderBy('queued_at').toArray();
  let pushed = 0;
  for (const table of SYNCED_TABLES) {
    const t = d.table(table);
    const mine = entries.filter((e) => e.table === table);

    const ups = mine.filter((e) => e.op === 'upsert');
    if (ups.length) {
      const rows = (await t.bulkGet(ups.map((e) => e.id))).filter(Boolean) as Row[];
      const serverRows = rows.length ? await remote.upsert(table, rows) : [];
      const byId = new Map(serverRows.map((r) => [r.id, r]));
      await d.transaction('rw', t, d.outbox, async () => {
        for (const e of ups) {
          const current = await d.outbox.get(e.key);
          if (!current || current.queued_at !== e.queued_at) continue; // changed again meanwhile
          await d.outbox.delete(e.key);
          const server = byId.get(e.id);
          if (server) await t.put(server); // adopt server timestamps
        }
      });
      pushed += ups.length;
    }

    const dels = mine.filter((e) => e.op === 'delete');
    if (dels.length) {
      await remote.remove(table, dels.map((e) => e.id));
      await d.transaction('rw', d.outbox, async () => {
        for (const e of dels) {
          const current = await d.outbox.get(e.key);
          if (current && current.queued_at === e.queued_at) await d.outbox.delete(e.key);
        }
      });
      pushed += dels.length;
    }
  }
  return pushed;
}

export async function pull(d: PilotDB, remote: Remote): Promise<void> {
  for (const table of SYNCED_TABLES) {
    const t = d.table(table);
    const cursorKey = `cursor:${table}`;
    const cursor = await getMeta<string>(d, cursorKey);
    const since = cursor ? new Date(Date.parse(cursor) - CURSOR_OVERLAP_MS).toISOString() : null;

    const rows = await remote.pullSince(table, since);
    const serverIds = new Set(await remote.listIds(table));

    await d.transaction('rw', t, d.outbox, d.meta, async () => {
      const pending = new Set((await d.outbox.where('key').startsWith(`${table}:`).toArray()).map((e) => e.id));
      let maxUpdated = cursor ?? '';
      for (const r of rows) {
        if (r.updated_at > maxUpdated) maxUpdated = r.updated_at;
        if (!pending.has(r.id)) await t.put(r);
      }
      const localIds = (await t.toCollection().primaryKeys()) as string[];
      const gone = localIds.filter((id) => !serverIds.has(id) && !pending.has(id));
      if (gone.length) await t.bulkDelete(gone);
      if (maxUpdated) await setMeta(d, cursorKey, maxUpdated);
    });
  }
}

const PAGE = 1000;

/** Remote backed by Supabase (PostgREST). All queries run under RLS as the signed-in user. */
export function supabaseRemote(sb: SupabaseClient, userId: string): Remote {
  const strip = (r: Record<string, unknown>): Row => {
    const { user_id, ...rest } = r;
    void user_id;
    return rest as Row;
  };
  return {
    async upsert(table, rows) {
      const { data, error } = await sb
        .from(table)
        .upsert(rows.map((r) => ({ ...r, user_id: userId })), { onConflict: 'id' })
        .select();
      if (error) throw error;
      return (data ?? []).map(strip);
    },
    async remove(table, ids) {
      const { error } = await sb.from(table).delete().in('id', ids);
      if (error) throw error;
    },
    async pullSince(table, cursor) {
      const out: Row[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = sb.from(table).select('*').order('updated_at').order('id').range(from, from + PAGE - 1);
        if (cursor) q = q.gt('updated_at', cursor);
        const { data, error } = await q;
        if (error) throw error;
        out.push(...(data ?? []).map(strip));
        if (!data || data.length < PAGE) return out;
      }
    },
    async listIds(table) {
      const out: string[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await sb.from(table).select('id').order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...(data ?? []).map((r: { id: string }) => r.id));
        if (!data || data.length < PAGE) return out;
      }
    },
  };
}
