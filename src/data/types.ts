/**
 * Row shapes. These mirror the Postgres tables exactly (snake_case) so the
 * same object can live in IndexedDB, be pushed to Supabase and be exported
 * without translation layers. See supabase/migrations for the source of truth.
 */

export type Score = 1 | 2 | 3 | 4 | 5;
export type TagKind = 'body' | 'context' | 'need' | 'event';
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
  /** Calendar events attached to this check-in, as they were at the time. */
  events: EventSnapshot[];
  extra: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** How an event related in time to the check-in it's attached to. */
export type EventRelation = 'upcoming' | 'now' | 'recent' | 'all_day' | 'earlier' | 'later';

export interface EventSnapshot {
  key: string; // calendar_events.event_key
  series_key: string;
  title: string | null;
  kind: string | null;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null; // exclusive
  relation: EventRelation;
  /** Minutes until start (positive) or since end (negative); 0 if happening/all-day. */
  offset_min: number;
}

export interface CalendarSource {
  id: string;
  name: string;
  default_kind: string | null;
  enabled: boolean;
  last_refreshed_at: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

/** Imported by the server; read-only on the device. */
export interface CalendarEvent {
  id: string;
  event_key: string;
  series_key: string;
  source_ids: string[];
  title: string | null;
  all_day: boolean;
  starts_at: string | null;
  ends_at: string | null;
  start_date: string | null;
  end_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface EventSeries {
  id: string;
  series_key: string;
  kind: string | null;
  title_override: string | null;
  hidden: boolean; // never pre-select
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

/** active_minutes: raw Exercise Minutes readings (daily totals); workout: condensed active periods (Check In). */
export type HealthMetric = 'workout' | 'mindful' | 'sleep' | 'hrv' | 'resting_hr' | 'active_minutes';

/** Imported from Apple Health by the server; read-only on the device. */
export interface HealthSampleRow {
  id: string;
  metric: HealthMetric;
  starts_at: string;
  ends_at: string;
  value: number | null; // hrv ms; resting_hr bpm; sleep/workout/mindful minutes
  unit: string | null;
  label: string | null; // workout type
  detail: Record<string, number>; // sleep: minutes per stage
  sample_key: string;
  created_at: string;
  updated_at: string;
}

/** Tables the device writes to (via the outbox). */
export type SyncedTable = 'check_ins' | 'periods' | 'tags' | 'calendar_sources' | 'event_series';
/** Tables the device reads from the server. */
export type PulledTable = SyncedTable | 'calendar_events' | 'health_samples';

export interface RowTypes {
  check_ins: CheckIn;
  periods: Period;
  tags: Tag;
  calendar_sources: CalendarSource;
  event_series: EventSeries;
  calendar_events: CalendarEvent;
  health_samples: HealthSampleRow;
}

/** A pending change waiting to reach the server. */
export interface OutboxEntry {
  key: string; // `${table}:${id}` — one pending op per row
  table: SyncedTable;
  id: string;
  op: 'upsert' | 'delete';
  queued_at: number; // ms; used to detect re-queues during a push
}
