import { describe, expect, it } from 'vitest';
import type { Period } from '../data/types';
import { containsWallClock, periodStatus, periodsFor } from './periods';

const period = (p: Partial<Period>): Period => ({
  id: 'p', title: 'T', description: null, category: null, start_date: '2026-11-30', start_time: null,
  end_date: '2026-12-14', end_time: null, extra: {}, created_at: '', updated_at: '', ...p,
});

describe('period membership', () => {
  const holiday = period({ title: 'Holiday' });

  it('includes whole start and end days when no times are set', () => {
    expect(containsWallClock(holiday, '2026-11-30', '00:00:00')).toBe(true);
    expect(containsWallClock(holiday, '2026-12-14', '23:59:59')).toBe(true);
    expect(containsWallClock(holiday, '2026-11-29', '23:59:59')).toBe(false);
    expect(containsWallClock(holiday, '2026-12-15', '00:00:00')).toBe(false);
  });

  it('respects start and end times', () => {
    const p = period({ start_time: '18:00', end_time: '09:00' });
    expect(containsWallClock(p, '2026-11-30', '17:59:00')).toBe(false);
    expect(containsWallClock(p, '2026-11-30', '18:00:00')).toBe(true);
    expect(containsWallClock(p, '2026-12-14', '09:00:00')).toBe(true);
    expect(containsWallClock(p, '2026-12-14', '09:01:00')).toBe(false);
  });

  it('treats a missing end as ongoing', () => {
    expect(containsWallClock(period({ end_date: null }), '2030-01-01', '12:00:00')).toBe(true);
  });

  it('supports overlapping periods', () => {
    const exp = period({ id: 'e', title: 'Experiment', start_date: '2026-12-10', end_date: null });
    const got = periodsFor({ local_date: '2026-12-12', local_time: '10:00:00' }, [holiday, exp]);
    expect(got.map((p) => p.title)).toEqual(['Holiday', 'Experiment']);
  });

  it('reports status relative to now', () => {
    expect(periodStatus(holiday, '2026-11-18', '12:00:00')).toBe('upcoming');
    expect(periodStatus(holiday, '2026-12-01', '12:00:00')).toBe('active');
    expect(periodStatus(holiday, '2026-12-15', '00:00:00')).toBe('past');
  });
});
