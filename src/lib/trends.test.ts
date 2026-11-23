import { describe, expect, it } from 'vitest';
import type { CheckIn, Period } from '../data/types';
import { daysIn, measureSeries, periodBands, presetRange, segments } from './trends';

const c = (o: Partial<CheckIn>): CheckIn => ({
  id: Math.random().toString(), observed_at: '', timezone: 'Europe/London', local_date: '2026-11-20', local_time: '09:00:00',
  mood: null, energy: null, anxiety: null, pressure: null, body_tags: [], context_tags: [], need_tags: [], thought: null,
  preceding: null, events: [], extra: {}, created_at: '', updated_at: '', ...o,
});

describe('ranges', () => {
  it('builds 7/30/90-day ranges ending today, inclusive', () => {
    expect(presetRange('7', '2026-11-23')).toEqual({ from: '2026-11-17', to: '2026-11-23' });
    expect(daysIn(presetRange('30', '2026-11-23'))).toHaveLength(30);
  });
});

describe('measureSeries', () => {
  const list = [
    c({ local_date: '2026-11-20', local_time: '18:00:00', mood: 4 }),
    c({ local_date: '2026-11-20', local_time: '08:00:00', mood: 2 }),
    c({ local_date: '2026-11-21', mood: 3 }),
    c({ local_date: '2026-11-22', mood: null }), // no mood recorded: not a zero
    c({ local_date: '2026-10-01', mood: 5 }), // out of range
  ];
  const s = measureSeries(list, 'mood', { from: '2026-11-17', to: '2026-11-23' });
  it('keeps every check-in as a point, in time order', () => {
    expect(s.points.map((p) => [p.date, p.time, p.value])).toEqual([
      ['2026-11-20', '08:00', 2],
      ['2026-11-20', '18:00', 4],
      ['2026-11-21', '09:00', 3],
    ]);
  });
  it('averages each day and counts check-ins', () => {
    expect(s.daily).toEqual([
      { date: '2026-11-20', value: 3, n: 2 },
      { date: '2026-11-21', value: 3, n: 1 },
    ]);
  });
});

describe('segments', () => {
  it('breaks the line across gaps of more than two days', () => {
    const pts = ['2026-11-01', '2026-11-02', '2026-11-04', '2026-11-08'].map((date) => ({ date, value: 1 }));
    expect(segments(pts).map((seg) => seg.map((p) => p.date))).toEqual([['2026-11-01', '2026-11-02', '2026-11-04'], ['2026-11-08']]);
  });
});

describe('periodBands', () => {
  const p = (o: Partial<Period>): Period => ({
    id: 'p', title: 'Holiday', description: null, category: null, start_date: '2026-11-30', start_time: null, end_date: '2026-12-14',
    end_time: null, extra: {}, created_at: '', updated_at: '', ...o,
  });
  it('clips periods to the range and drops ones outside it', () => {
    const bands = periodBands([p({}), p({ id: 'old', title: 'Old', start_date: '2026-01-01', end_date: '2026-01-10' }), p({ id: 'on', title: 'Ongoing', start_date: '2026-11-10', end_date: null })], {
      from: '2026-11-24',
      to: '2026-12-07',
    });
    expect(bands).toEqual([
      { id: 'on', title: 'Ongoing', from: '2026-11-24', to: '2026-12-07' },
      { id: 'p', title: 'Holiday', from: '2026-11-30', to: '2026-12-07' },
    ]);
  });
});
