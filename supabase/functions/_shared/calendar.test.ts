import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { importWindow, mergeCalendars, parseFeed } from './calendar';

const fixture = (name: string) => readFileSync(join(__dirname, 'fixtures', name), 'utf8');
const W = { from: new Date('2026-11-12T00:00:00Z'), to: new Date('2026-12-03T00:00:00Z') };

describe('parseFeed (Google)', () => {
  const events = parseFeed(fixture('google.ics'), 'home', W);
  const titled = (t: string) => events.filter((e) => e.title === t);

  it('imports a timed event at the right instant, with nothing but title and times', () => {
    const [dentist] = titled('Dentist');
    expect(dentist).toEqual({
      event_key: 'dentist-123@google.com|2026-11-20T10:00:00', series_key: 'dentist-123@google.com', title: 'Dentist',
      all_day: false, starts_at: '2026-11-20T10:00:00.000Z', ends_at: '2026-11-20T10:30:00.000Z', start_date: null, end_date: null,
      source_ids: ['home'],
    });
    expect(JSON.stringify(events)).not.toMatch(/Private notes|High Street|neil@example/);
  });

  it('keeps all-day events as dates with an exclusive end', () => {
    expect(titled("Neil's parents visiting")[0]).toMatchObject({ all_day: true, start_date: '2026-11-21', end_date: '2026-11-23' });
  });

  it('expands recurring events, honouring EXDATE, moved and cancelled occurrences', () => {
    const gym = events.filter((e) => e.series_key === 'gym-789@google.com').map((e) => `${e.starts_at} ${e.title}`);
    expect(gym).toEqual([
      '2026-11-16T07:00:00.000Z Gym', // Mon (GMT)
      // Wed 18th excluded by EXDATE
      '2026-11-23T18:30:00.000Z Gym (evening)', // Mon moved to the evening
      // Wed 25th cancelled
      '2026-11-30T07:00:00.000Z Gym',
      '2026-12-02T07:00:00.000Z Gym',
    ]);
  });

  it('skips cancelled events and anything outside the window', () => {
    expect(titled('Dinner (called off)')).toHaveLength(0);
    expect(titled('Far away')).toHaveLength(0);
  });
});

describe('parseFeed (Outlook / Microsoft 365)', () => {
  it('resolves Windows time zone names via the feed’s VTIMEZONE, including summer time', () => {
    const nov = parseFeed(fixture('outlook.ics'), 'work', W);
    expect(nov.map((e) => [e.title, e.starts_at])).toEqual([['Quarterly review', '2026-11-20T14:00:00.000Z']]);
    const summer = parseFeed(fixture('outlook.ics'), 'work', { from: new Date('2026-06-30T00:00:00Z'), to: new Date('2026-07-02T00:00:00Z') });
    expect(summer[0]?.starts_at).toBe('2026-07-01T08:00:00.000Z'); // 09:00 BST
  });
});

describe('mergeCalendars', () => {
  const merged = mergeCalendars([parseFeed(fixture('google.ics'), 'home', W), parseFeed(fixture('google-second.ics'), 'shared', W)]);

  it('merges the same event shared into two calendars', () => {
    const dentist = merged.filter((e) => e.title === 'Dentist');
    expect(dentist).toHaveLength(1);
    expect(dentist[0]!.source_ids).toEqual(['home', 'shared']);
  });

  it('merges identical title + time even with different UIDs', () => {
    const visits = merged.filter((e) => e.title?.startsWith('Neil'));
    expect(visits).toHaveLength(1);
    expect(visits[0]!.source_ids).toEqual(['home', 'shared']);
  });

  it('keeps distinct events and sorts by start', () => {
    expect(merged.some((e) => e.title === 'Lunch with Sam')).toBe(true);
    const starts = merged.map((e) => (e.all_day ? e.start_date! : e.starts_at!.slice(0, 10)));
    expect([...starts].sort()).toEqual(starts);
  });
});

describe('robustness', () => {
  it('rejects input that isn’t a calendar', () => {
    expect(() => parseFeed('<html>Sign in</html>', 'x', W)).toThrow();
  });
  it('window is a week back and two weeks ahead', () => {
    const w = importWindow(new Date('2026-11-19T12:00:00Z'));
    expect(w.from.toISOString()).toBe('2026-11-12T12:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-12-03T12:00:00.000Z');
  });
});
