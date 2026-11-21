import type { CalendarEvent, HealthSampleRow } from '../data/types';

/**
 * Apple Health samples as attachable items. Workouts, mindful sessions and
 * sleep behave like calendar events in Check In ("Around now"), so they reuse
 * the same picker and snapshots. HRV and resting heart rate are daily context
 * for analysis, not attached to individual check-ins.
 */

export const HEALTH_SOURCE_ID = 'apple-health';

export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const r = m % 60;
  return r ? `${h}h ${String(r).padStart(2, '0')}m` : `${h}h`;
}

export function isHealthSeries(seriesKey: string): boolean {
  return seriesKey.startsWith('health:');
}

/** Default kind for a health item (overridable per series like any event). */
export function healthKind(seriesKey: string): string | null {
  if (seriesKey.startsWith('health:workout')) return 'Exercise';
  if (seriesKey === 'health:mindful') return 'Mindful';
  if (seriesKey === 'health:sleep') return 'Sleep';
  return null;
}

export function healthToEvents(samples: HealthSampleRow[]): CalendarEvent[] {
  const out: CalendarEvent[] = [];
  for (const s of samples) {
    if (s.metric !== 'workout' && s.metric !== 'mindful' && s.metric !== 'sleep') continue;
    const mins = s.value ?? (Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 60000;
    const label = s.label?.trim() || 'Workout';
    const series_key = s.metric === 'workout' ? `health:workout:${label.toLowerCase()}` : `health:${s.metric}`;
    const title = s.metric === 'workout' ? `${label} · ${formatMinutes(mins)}` : s.metric === 'mindful' ? `Mindful session · ${formatMinutes(mins)}` : `Sleep · ${formatMinutes(mins)}`;
    out.push({
      id: s.id,
      event_key: `health:${s.sample_key}`,
      series_key,
      source_ids: [HEALTH_SOURCE_ID],
      title,
      all_day: false,
      starts_at: s.starts_at,
      ends_at: s.ends_at,
      start_date: null,
      end_date: null,
      created_at: s.created_at,
      updated_at: s.updated_at,
    });
  }
  return out;
}
