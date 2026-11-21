import { describe, expect, it } from 'vitest';
import { parseLines, summarise } from './health';

const NOW = new Date('2026-11-21T22:00:00Z');

describe('parseLines', () => {
  it('reads workouts, mindful sessions, HRV and resting heart rate', () => {
    const r = parseLines(
      [
        'workout|2026-11-21T07:10:00Z|2026-11-21T07:45:00Z|||Running',
        'Mindful Minutes|2026-11-21T08:00:00+00:00|2026-11-21T08:10:00+00:00',
        'Heart Rate Variability|2026-11-21T03:00:00Z|2026-11-21T03:01:00Z|48,2 ms|ms',
        'resting heart rate|2026-11-21T00:00:00Z|2026-11-21T23:59:00Z|58|count/min',
      ].join('\n'),
      NOW,
    );
    expect(r.skipped).toEqual([]);
    expect(r.samples).toEqual([
      { metric: 'workout', starts_at: '2026-11-21T07:10:00.000Z', ends_at: '2026-11-21T07:45:00.000Z', value: 35, unit: 'min', label: 'Running', detail: {}, sample_key: 'workout|2026-11-21T07:10:00.000Z' },
      { metric: 'mindful', starts_at: '2026-11-21T08:00:00.000Z', ends_at: '2026-11-21T08:10:00.000Z', value: 10, unit: 'min', label: null, detail: {}, sample_key: 'mindful|2026-11-21T08:00:00.000Z' },
      { metric: 'hrv', starts_at: '2026-11-21T03:00:00.000Z', ends_at: '2026-11-21T03:01:00.000Z', value: 48.2, unit: 'ms', label: null, detail: {}, sample_key: 'hrv|2026-11-21T03:00:00.000Z' },
      { metric: 'resting_hr', starts_at: '2026-11-21T00:00:00.000Z', ends_at: '2026-11-21T23:59:00.000Z', value: 58, unit: 'bpm', label: null, detail: {}, sample_key: 'resting_hr|2026-11-21T00:00:00.000Z' },
    ]);
  });

  it('accepts offsets without a colon and a workout type in the value field', () => {
    const r = parseLines('workout|2026-11-21T07:10:00+0100|2026-11-21T08:10:00+0100|Traditional Strength Training', NOW);
    expect(r.samples[0]).toMatchObject({ starts_at: '2026-11-21T06:10:00.000Z', label: 'Traditional Strength Training', value: 60 });
  });

  it('condenses sleep stages into one night, counting overlapping devices once', () => {
    const r = parseLines(
      [
        'sleep|2026-11-20T23:00:00Z|2026-11-21T07:00:00Z|In Bed', // iPhone
        'sleep|2026-11-20T23:15:00Z|2026-11-21T01:00:00Z|Core',
        'sleep|2026-11-21T01:00:00Z|2026-11-21T02:00:00Z|Deep',
        'sleep|2026-11-21T02:00:00Z|2026-11-21T02:20:00Z|Awake',
        'sleep|2026-11-21T02:20:00Z|2026-11-21T06:30:00Z|REM',
        'sleep|2026-11-21T02:20:00Z|2026-11-21T03:00:00Z|REM', // duplicate from a second source
        'sleep|2026-11-21T14:00:00Z|2026-11-21T14:40:00Z|Core', // afternoon nap: separate session
      ].join('\n'),
      NOW,
    );
    const nights = r.samples.filter((s) => s.metric === 'sleep');
    expect(nights).toHaveLength(2);
    expect(nights[0]).toMatchObject({
      starts_at: '2026-11-20T23:00:00.000Z', ends_at: '2026-11-21T07:00:00.000Z', value: 415, sample_key: 'sleep|2026-11-20T23:00:00.000Z',
      detail: { asleep: 415, core: 105, deep: 60, rem: 250, awake: 20, in_bed: 480 },
    });
    expect(nights[1]).toMatchObject({ value: 40 });
    expect(r.sleepReadings).toBe(7);
  });

  it('explains what it skipped', () => {
    const r = parseLines(
      [
        'workout|21 Nov 2026 at 07:10|21 Nov 2026 at 07:45|||Running', // date format not set to ISO
        'workout|2026-11-21T07:10:00|2026-11-21T07:45:00', // no time zone
        'steps|2026-11-21T07:10:00Z|2026-11-21T07:45:00Z|500',
        'hrv|2026-11-21T03:00:00Z|2026-11-21T03:01:00Z|',
        'sleep|2026-11-21T01:00:00Z|2026-11-21T02:00:00Z|',
        'workout|2020-01-01T07:00:00Z|2020-01-01T08:00:00Z',
        '',
        '# comment',
      ].join('\n'),
      NOW,
    );
    expect(r.samples).toEqual([]);
    expect(r.skipped.map((s) => s.line)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(r.skipped[0]!.reason).toMatch(/ISO 8601/);
    expect(r.skipped[2]!.reason).toMatch(/unknown type "steps"/);
  });

  it('ignores repeated readings within one send', () => {
    const line = 'mindful|2026-11-21T08:00:00Z|2026-11-21T08:10:00Z';
    expect(parseLines(`${line}\n${line}`, NOW).samples).toHaveLength(1);
  });
});

describe('summarise', () => {
  it('gives a readable result for the Shortcut to show', () => {
    const r = parseLines('workout|2026-11-21T07:10:00Z|2026-11-21T07:45:00Z|||Running\nhrv|bad|bad|40', NOW);
    expect(summarise(r)).toBe('Pilot received 1 workout. Skipped 1 line (line 2: dates must be ISO 8601 with a time zone (in Shortcuts, set the date format to ISO 8601)).');
  });
});
