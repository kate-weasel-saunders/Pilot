import type { CalendarSource, CheckIn, EventSeries, EventSnapshot, HealthSampleRow, Period, Tag } from '../data/types';
import { partOfDay, weekdayOf } from './time';
import { periodsFor } from './periods';

/**
 * Exports. JSON is the full-fidelity backup (re-importable later); CSV is a
 * flat, analysis-friendly view with derived columns added.
 */

export const EXPORT_FORMAT_VERSION = 1;

export interface ExportData {
  check_ins: CheckIn[];
  periods: Period[];
  tags: Tag[];
  /** Calendar names and default kinds. Secret links live only on the server and are never exported. */
  calendar_sources?: CalendarSource[];
  event_series?: EventSeries[];
  health_samples?: HealthSampleRow[];
}

export function buildJsonExport(data: ExportData, now = new Date()) {
  return JSON.stringify(
    {
      format: 'pilot-export',
      version: EXPORT_FORMAT_VERSION,
      exported_at: now.toISOString(),
      check_ins: [...data.check_ins].sort((a, b) => a.observed_at.localeCompare(b.observed_at)),
      periods: data.periods,
      tags: data.tags,
      calendar_sources: (data.calendar_sources ?? []).map(({ id, name, default_kind, enabled }) => ({ id, name, default_kind, enabled })),
      event_series: data.event_series ?? [],
      health_samples: [...(data.health_samples ?? [])].sort((a, b) => a.starts_at.localeCompare(b.starts_at)),
    },
    null,
    2,
  );
}

export function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = Array.isArray(v) ? v.join('; ') : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Quote when needed; neutralise leading characters spreadsheets treat as formulas.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/** e.g. "Dentist [Appointment] (upcoming, 180 min)" */
export function describeEvent(e: EventSnapshot): string {
  const kind = e.kind ? ` [${e.kind}]` : '';
  const timing = e.relation === 'all_day' || e.relation === 'now' ? e.relation.replace('_', '-') : `${e.relation}, ${Math.abs(e.offset_min)} min`;
  return `${e.title ?? 'Untitled event'}${kind} (${timing})`;
}

function toCsv(header: string[], rows: unknown[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export function buildCheckInsCsv(checkIns: CheckIn[], periods: Period[]): string {
  const header = [
    'id', 'observed_at', 'timezone', 'local_date', 'local_time', 'weekday', 'part_of_day',
    'mood', 'energy', 'anxiety', 'pressure', 'body_tags', 'context_tags', 'need_tags',
    'thought', 'preceding', 'events', 'periods', 'created_at', 'updated_at',
  ];
  const rows = [...checkIns]
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at))
    .map((c) => [
      c.id, c.observed_at, c.timezone, c.local_date, c.local_time.slice(0, 5), weekdayOf(c.local_date), partOfDay(c.local_time),
      c.mood, c.energy, c.anxiety, c.pressure, c.body_tags, c.context_tags, c.need_tags,
      c.thought, c.preceding, (c.events ?? []).map(describeEvent), periodsFor(c, periods).map((p) => p.title), c.created_at, c.updated_at,
    ]);
  return toCsv(header, rows);
}

export function buildHealthCsv(samples: HealthSampleRow[]): string {
  const header = ['metric', 'starts_at', 'ends_at', 'value', 'unit', 'label', 'sleep_asleep_min', 'sleep_deep_min', 'sleep_rem_min', 'sleep_core_min', 'sleep_awake_min'];
  const rows = [...samples]
    .sort((a, b) => a.starts_at.localeCompare(b.starts_at))
    .map((s) => [s.metric, s.starts_at, s.ends_at, s.value, s.unit, s.label, s.detail?.asleep, s.detail?.deep, s.detail?.rem, s.detail?.core, s.detail?.awake]);
  return toCsv(header, rows);
}

export function buildPeriodsCsv(periods: Period[]): string {
  const header = ['id', 'title', 'category', 'description', 'start_date', 'start_time', 'end_date', 'end_time'];
  return toCsv(header, periods.map((p) => [p.id, p.title, p.category, p.description, p.start_date, p.start_time, p.end_date, p.end_time]));
}
