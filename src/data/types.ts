/**
 * Row shapes. These mirror the Postgres tables exactly (snake_case) so the
 * same object can live in IndexedDB, be pushed to Supabase and be exported
 * without translation layers. See supabase/migrations for the source of truth.
 */

export type Score = 1 | 2 | 3 | 4 | 5;
export type TagKind = 'body' | 'context' | 'need';
export type MeasureKey = 'mood' | 'energy' | 'anxiety' | 'pressure';

export interface CheckIn {
  id: string;
  observed_at: string; // ISO instant
  timezone: string; // IANA zone, e.g. "Europe/London"
  local_date: string; // YYYY-MM-DD in `timezone`
  local_time: string; // HH:MM:SS in `timezone`
  mood: Score | null;
  energy: Score | null;
  anxiety: Score | null;
  pressure: Score | null;
  body_tags: string[];
  context_tags: string[];
  need_tags: string[];
  thought: string | null;
  preceding: string | null;
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Period {
  id: string;
  title: string;
  description: string | null;
  category: string | null;
  start_date: string; // YYYY-MM-DD (floating local date)
  start_time: string | null; // HH:MM[:SS]; null = start of day
  end_date: string | null; // null = ongoing
  end_time: string | null; // null = end of day
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Tag {
  id: string;
  kind: TagKind;
  label: string;
  hidden: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
}

export type SyncedTable = 'check_ins' | 'periods' | 'tags';

/** A pending change waiting to reach the server. */
export interface OutboxEntry {
  key: string; // `${table}:${id}` — one pending op per row
  table: SyncedTable;
  id: string;
  op: 'upsert' | 'delete';
  queued_at: number; // ms; used to detect re-queues during a push
}
