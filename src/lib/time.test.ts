import { describe, expect, it } from 'vitest';
import { addDays, instantFromWallClock, isWeekend, localFields, partOfDay, sinceLabel, wallClock, weekdayOf } from './time';

describe('wallClock / localFields', () => {
  it('derives the wall clock in the given zone, not the machine zone', () => {
    const instant = new Date('2026-12-01T23:30:00Z');
    expect(wallClock(instant, 'Europe/London')).toEqual({ date: '2026-12-01', time: '23:30:00' });
    expect(wallClock(instant, 'Asia/Tokyo')).toEqual({ date: '2026-12-02', time: '08:30:00' });
    expect(wallClock(instant, 'America/New_York')).toEqual({ date: '2026-12-01', time: '18:30:00' });
  });

  it('produces storable fields', () => {
    expect(localFields(new Date('2026-07-01T07:05:00Z'), 'Europe/London')).toEqual({
      observed_at: '2026-07-01T07:05:00.000Z',
      timezone: 'Europe/London',
      local_date: '2026-07-01',
      local_time: '08:05:00',
    });
  });
});

describe('instantFromWallClock', () => {
  it('round-trips in winter and summer time', () => {
    for (const iso of ['2026-01-15T09:00:00Z', '2026-07-15T09:00:00Z']) {
      const { date, time } = wallClock(new Date(iso), 'Europe/London');
      expect(instantFromWallClock(date, time, 'Europe/London').toISOString()).toBe(new Date(iso).toISOString());
    }
  });

  it('accepts HH:MM', () => {
    expect(instantFromWallClock('2026-12-01', '08:30', 'Asia/Tokyo').toISOString()).toBe('2026-11-30T23:30:00.000Z');
  });

  it('handles the hours either side of a DST change', () => {
    // UK clocks go back at 02:00 BST on 25 Oct 2026.
    expect(instantFromWallClock('2026-10-25', '00:30', 'Europe/London').toISOString()).toBe('2026-10-24T23:30:00.000Z');
    expect(instantFromWallClock('2026-10-25', '03:00', 'Europe/London').toISOString()).toBe('2026-10-25T03:00:00.000Z');
  });

  it('rejects garbage', () => {
    expect(() => instantFromWallClock('nope', '10:00', 'UTC')).toThrow();
  });
});

describe('derived properties', () => {
  it('maps hours to parts of day', () => {
    expect(partOfDay('04:59:00')).toBe('late night');
    expect(partOfDay('05:00:00')).toBe('morning');
    expect(partOfDay('11:59:00')).toBe('morning');
    expect(partOfDay('12:00:00')).toBe('afternoon');
    expect(partOfDay('17:00:00')).toBe('evening');
    expect(partOfDay('22:00:00')).toBe('late night');
  });

  it('computes weekdays and weekends from calendar dates', () => {
    expect(weekdayOf('2026-11-18')).toBe('Wednesday');
    expect(isWeekend('2026-11-21')).toBe(true);
    expect(isWeekend('2026-11-23')).toBe(false);
  });

  it('adds days across month and year ends', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('sinceLabel', () => {
  const now = Date.parse('2026-11-26T21:30:00Z');
  const tz = 'Europe/London';
  it('is relative for the last hour', () => {
    expect(sinceLabel('2026-11-26T21:29:40Z', now, tz)).toBe('just now');
    expect(sinceLabel('2026-11-26T21:18:00Z', now, tz)).toBe('12 min ago');
  });
  it('names today and yesterday with a time', () => {
    expect(sinceLabel('2026-11-26T09:14:00Z', now, tz)).toBe('today at 09:14');
    expect(sinceLabel('2026-11-25T21:05:00Z', now, tz)).toBe('yesterday at 21:05');
  });
  it('uses the date further back', () => {
    expect(sinceLabel('2026-11-24T08:30:00Z', now, tz)).toMatch(/24.*at 08:30$/);
  });
});
