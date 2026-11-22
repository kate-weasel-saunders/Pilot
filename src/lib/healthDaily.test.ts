import { describe, expect, it } from 'vitest';
import type { HealthSampleRow } from '../data/types';
import { indexByDay, summarise } from './healthDaily';

let n = 0;
const s = (metric: HealthSampleRow['metric'], starts_at: string, ends_at: string, value: number): HealthSampleRow => ({
  id: String(++n), metric, starts_at, ends_at, value, unit: null, label: metric === 'workout' ? 'Exercise' : null, detail: {},
  sample_key: String(n), created_at: '', updated_at: '',
});

const samples = [
  s('sleep', '2026-11-19T23:10:00Z', '2026-11-20T06:40:00Z', 412), // the night before Fri 20th
  s('sleep', '2026-11-20T14:00:00Z', '2026-11-20T14:30:00Z', 30), // a nap on the 20th: not "the night"
  s('hrv', '2026-11-20T03:00:00Z', '2026-11-20T03:01:00Z', 44),
  s('hrv', '2026-11-20T09:00:00Z', '2026-11-20T09:01:00Z', 52),
  s('resting_hr', '2026-11-20T00:00:00Z', '2026-11-20T23:59:00Z', 57),
  s('workout', '2026-11-20T07:00:00Z', '2026-11-20T07:35:00Z', 35),
  s('workout', '2026-11-20T17:00:00Z', '2026-11-20T17:12:00Z', 12),
  s('mindful', '2026-11-20T21:00:00Z', '2026-11-20T21:10:00Z', 10),
  s('hrv', '2026-11-21T03:00:00Z', '2026-11-21T03:01:00Z', 60), // next day
];

describe('active total matches the Watch', () => {
  it('counts every exercise minute, including short bursts left out of active periods', () => {
    const day = [
      s('workout', '2026-11-20T07:00:00Z', '2026-11-20T07:20:00Z', 20), // the 20-minute active period
      s('active_minutes', '2026-11-20T07:00:00Z', '2026-11-20T07:10:00Z', 10),
      s('active_minutes', '2026-11-20T07:10:00Z', '2026-11-20T07:20:00Z', 10),
      s('active_minutes', '2026-11-20T12:00:00Z', '2026-11-20T12:04:00Z', 4), // short burst
      s('active_minutes', '2026-11-20T16:00:00Z', '2026-11-20T16:05:00Z', 5), // short burst
      s('active_minutes', '2026-11-20T16:00:00Z', '2026-11-20T16:05:00Z', 5), // same minutes from a second source
    ];
    expect(summarise(day)?.activeMin).toBe(29);
  });
});

describe('day health', () => {
  const byDay = indexByDay(samples, 'Europe/London');

  it('summarises a day: night’s sleep, average HRV, resting HR, total active and mindful minutes', () => {
    expect(summarise(byDay.get('2026-11-20'))).toEqual({ sleepMin: 412, hrv: 48, restingHr: 57, activeMin: 47, mindfulMin: 10 });
  });

  it('leaves missing measures empty rather than zero', () => {
    expect(summarise(byDay.get('2026-11-21'))).toEqual({ sleepMin: null, hrv: 60, restingHr: null, activeMin: null, mindfulMin: null });
    expect(summarise(byDay.get('2026-11-22'))).toBeNull();
  });

  it('places days by local time', () => {
    // 23:30 UTC is 08:30 next day in Tokyo
    const t = indexByDay([s('hrv', '2026-11-20T23:30:00Z', '2026-11-20T23:31:00Z', 40)], 'Asia/Tokyo');
    expect([...t.keys()]).toEqual(['2026-11-21']);
  });
});
