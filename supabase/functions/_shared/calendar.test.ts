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

describe('long-running repeating events', () => {
  const ics = (rule: string, start: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:old-${rule}\r\nDTSTART:${start}\r\nDTEND:${start.replace('T0800', 'T0815')}\r\nRRULE:${rule}\r\nSUMMARY:Old ${rule}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;
  it('still finds this week’s occurrence of a daily event that started years ago', () => {
    const got = parseFeed(ics('FREQ=DAILY', '20190101T080000Z'), 'a', W);
    expect(got.length).toBe(21);
    expect(got.some((e) => e.starts_at === '2026-11-20T08:00:00.000Z')).toBe(true);
  });
  it('handles an hourly rule from years ago without hanging', () => {
    const t = Date.now();
    parseFeed(ics('FREQ=HOURLY', '20240101T080000Z'), 'a', W);
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

describe('fast-forwarding old series gives identical results', () => {
  const cal = (body: string) => `BEGIN:VCALENDAR\r\nVERSION:2.0\r\n${fixture('google.ics').match(/BEGIN:VTIMEZONE[\s\S]*?END:VTIMEZONE\r?\n/)![0]}${body}END:VCALENDAR\r\n`;
  it('fortnightly since 2018 keeps its phase, local time across DST, exclusions and moved occurrences', () => {
    const got = parseFeed(cal([
      'BEGIN:VEVENT', 'UID:fortnight', 'DTSTART;TZID=Europe/London:20180706T083000', 'DTEND;TZID=Europe/London:20180706T093000',
      'RRULE:FREQ=WEEKLY;INTERVAL=2', 'EXDATE;TZID=Europe/London:20261127T083000', 'SUMMARY:Fortnightly', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:fortnight', 'RECURRENCE-ID;TZID=Europe/London:20261113T083000', 'DTSTART;TZID=Europe/London:20261114T110000',
      'DTEND;TZID=Europe/London:20261114T120000', 'SUMMARY:Fortnightly (moved)', 'END:VEVENT', '',
    ].join('\r\n')), 'a', W);
    // Expected by plain date arithmetic: every 14 days from Fri 6 Jul 2018, 08:30 London.
    const expected: string[] = [];
    for (let d = Date.UTC(2018, 6, 6); d <= W.to.getTime(); d += 14 * 86400000) {
      const iso = new Date(d).toISOString().slice(0, 10);
      if (iso >= '2026-11-12' && iso !== '2026-11-27' && iso !== '2026-11-13') expected.push(`${iso}T08:30:00.000Z`); // GMT in Nov
    }
    expect(got.filter((e) => e.title === 'Fortnightly').map((e) => e.starts_at)).toEqual(expected);
    expect(got.find((e) => e.title === 'Fortnightly (moved)')).toMatchObject({ starts_at: '2026-11-14T11:00:00.000Z', event_key: 'fortnight|2026-11-13T08:30:00' });
  });
  it('keeps one-off events that span into the window', () => {
    const got = parseFeed(cal(['BEGIN:VEVENT', 'UID:trip', 'DTSTART;VALUE=DATE:20261101', 'DTEND;VALUE=DATE:20261115', 'SUMMARY:Long trip', 'END:VEVENT', ''].join('\r\n')), 'a', W);
    expect(got.map((e) => e.title)).toEqual(['Long trip']);
  });
  it('drops one-off events far from the window', () => {
    const got = parseFeed(cal(['BEGIN:VEVENT', 'UID:old', 'DTSTART:20170101T090000Z', 'DTEND:20170101T100000Z', 'SUMMARY:Old', 'END:VEVENT', ''].join('\r\n')), 'a', W);
    expect(got).toEqual([]);
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
