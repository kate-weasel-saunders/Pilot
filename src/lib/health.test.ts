import { describe, expect, it } from 'vitest';
import type { HealthSampleRow } from '../data/types';
import { buildContext, candidatesFor, resolveKind, snapshotOf } from './calendar';
import { formatMinutes, healthToEvents } from './health';

const row = (o: Partial<HealthSampleRow>): HealthSampleRow => ({
  id: o.sample_key ?? 'x', metric: 'workout', starts_at: '', ends_at: '', value: null, unit: null, label: null, detail: {},
  sample_key: 'k', created_at: '', updated_at: '', ...o,
});
const run = row({ metric: 'workout', label: 'Running', value: 35, starts_at: '2026-11-20T06:25:00Z', ends_at: '2026-11-20T07:00:00Z', sample_key: 'workout|run' });
const sleep = row({ metric: 'sleep', value: 412, starts_at: '2026-11-19T23:10:00Z', ends_at: '2026-11-20T06:40:00Z', sample_key: 'sleep|n', detail: { asleep: 412 } });
const hrv = row({ metric: 'hrv', value: 48, starts_at: '2026-11-20T03:00:00Z', ends_at: '2026-11-20T03:01:00Z', sample_key: 'hrv|1' });
const ctx = buildContext([], []);
const at = (iso: string) => new Date(iso);

describe('healthToEvents', () => {
  it('turns workouts, mindful sessions and sleep into attachable items; HRV stays out', () => {
    const ev = healthToEvents([run, sleep, hrv, row({ metric: 'mindful', value: 10, starts_at: '2026-11-20T08:00:00Z', ends_at: '2026-11-20T08:10:00Z', sample_key: 'mindful|1' })]);
    expect(ev.map((e) => e.title)).toEqual(['Running · 35 min', 'Sleep · 6h 52m', 'Mindful session · 10 min']);
    expect(ev.map((e) => resolveKind(e, ctx))).toEqual(['Exercise', 'Sleep', 'Mindful']);
  });
  it('formats durations', () => {
    expect(formatMinutes(35)).toBe('35 min');
    expect(formatMinutes(60)).toBe('1h');
    expect(formatMinutes(412)).toBe('6h 52m');
  });
});

describe('in Check In', () => {
  const events = healthToEvents([run, sleep]);
  it('pre-ticks a run that ended an hour ago and last night’s sleep', () => {
    const c = candidatesFor(events, at('2026-11-20T08:00:00Z'), '2026-11-20', 'Europe/London', ctx);
    expect(c.suggested.map((e) => e.title)).toEqual(['Sleep · 6h 52m', 'Running · 35 min']);
  });
  it('keeps last night’s sleep ticked into the evening, but not the morning run', () => {
    const c = candidatesFor(events, at('2026-11-20T19:00:00Z'), '2026-11-20', 'Europe/London', ctx);
    expect(c.suggested.map((e) => e.title)).toEqual(['Sleep · 6h 52m']);
    expect(c.others.map((e) => e.title)).toEqual(['Running · 35 min']);
  });
  it('snapshots carry kind and timing like calendar events', () => {
    expect(snapshotOf(events[0]!, at('2026-11-20T08:00:00Z'), '2026-11-20', ctx)).toMatchObject({ title: 'Running · 35 min', kind: 'Exercise', relation: 'recent', offset_min: -60 });
  });
  it('lets the user change a health item’s kind per series', () => {
    const c = buildContext([{ id: '1', series_key: 'health:workout:running', kind: 'Personal', title_override: null, hidden: false, created_at: '', updated_at: '1' }], []);
    expect(resolveKind(events[0]!, c)).toBe('Personal');
  });
});
