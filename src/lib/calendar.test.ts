import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarSource, EventSeries } from '../data/types';
import { buildContext, candidatesFor, relationLabel, relationTo, resolveKind, snapshotOf } from './calendar';

const ev = (o: Partial<CalendarEvent>): CalendarEvent => ({
  id: o.event_key ?? 'x', event_key: 'k', series_key: 's', source_ids: ['home'], title: 'T', all_day: false,
  starts_at: null, ends_at: null, start_date: null, end_date: null, created_at: '', updated_at: '', ...o,
});
const source = (o: Partial<CalendarSource> = {}): CalendarSource => ({
  id: 'home', name: 'Home', default_kind: null, enabled: true, last_refreshed_at: null, last_error: null, created_at: '', updated_at: '', ...o,
});
const ctx = (series: Partial<EventSeries>[] = [], sources = [source()]) =>
  buildContext(series.map((s, i) => ({ id: `${i}`, series_key: 's', kind: null, title_override: null, hidden: false, created_at: '', updated_at: `${i}`, ...s })), sources);

// Friday 20 Nov 2026, London (GMT, so local = UTC)
const dentist = ev({ event_key: 'dentist', series_key: 'dentist', title: 'Dentist', starts_at: '2026-11-20T10:00:00Z', ends_at: '2026-11-20T10:30:00Z' });
const at = (hhmm: string) => new Date(`2026-11-20T${hhmm}:00Z`);

describe('the dentist example', () => {
  it('is pre-ticked on waking (3h before)', () => {
    expect(relationTo(dentist, at('07:00'), '2026-11-20')).toEqual({ relation: 'upcoming', offset_min: 180, suggested: true });
  });
  it('is pre-ticked during and up to 3 hours after', () => {
    expect(relationTo(dentist, at('10:15'), '2026-11-20').relation).toBe('now');
    expect(relationTo(dentist, at('12:30'), '2026-11-20')).toEqual({ relation: 'recent', offset_min: -120, suggested: true });
  });
  it('is offered but not ticked by the afternoon', () => {
    expect(relationTo(dentist, at('16:00'), '2026-11-20')).toEqual({ relation: 'earlier', offset_min: -330, suggested: false });
    const c = candidatesFor([dentist], at('16:00'), '2026-11-20', 'Europe/London', ctx());
    expect(c.suggested).toHaveLength(0);
    expect(c.others.map((e) => e.title)).toEqual(['Dentist']);
  });
});

describe('look-ahead', () => {
  it('picks up tomorrow morning from an evening check-in (within 12h)', () => {
    const standup = ev({ event_key: 'st', starts_at: '2026-11-21T09:00:00Z', ends_at: '2026-11-21T09:15:00Z' });
    expect(relationTo(standup, at('21:30'), '2026-11-20').suggested).toBe(true);
    expect(relationTo(standup, at('20:30'), '2026-11-20')).toMatchObject({ relation: 'later', suggested: false });
  });
});

describe('all-day events', () => {
  const visit = ev({ event_key: 'v', all_day: true, start_date: '2026-11-21', end_date: '2026-11-23' });
  it('apply to every day they cover, and no others', () => {
    expect(relationTo(visit, at('08:00'), '2026-11-21').relation).toBe('all_day');
    expect(relationTo(visit, at('08:00'), '2026-11-22').suggested).toBe(true);
    expect(relationTo(visit, at('08:00'), '2026-11-23').suggested).toBe(false); // end is exclusive
  });
});

describe('preferences', () => {
  it('never pre-ticks a hidden series, but still offers it', () => {
    const c = candidatesFor([dentist], at('09:00'), '2026-11-20', 'Europe/London', ctx([{ series_key: 'dentist', hidden: true }]));
    expect(c.suggested).toHaveLength(0);
    expect(c.others).toHaveLength(1);
  });
  it('ignores events from disabled or removed calendars', () => {
    expect(candidatesFor([dentist], at('09:00'), '2026-11-20', 'UTC', ctx([], [source({ enabled: false })])).suggested).toHaveLength(0);
    expect(candidatesFor([dentist], at('09:00'), '2026-11-20', 'UTC', ctx([], [])).suggested).toHaveLength(0);
  });
  it('takes kind from the series, then the calendar default', () => {
    expect(resolveKind(dentist, ctx([], [source({ default_kind: 'Family' })]))).toBe('Family');
    expect(resolveKind(dentist, ctx([{ series_key: 'dentist', kind: 'Appointment' }], [source({ default_kind: 'Family' })]))).toBe('Appointment');
  });
  it('uses the latest preference if two exist for a series', () => {
    const c = ctx([{ series_key: 'dentist', kind: 'Old', updated_at: '1' }, { series_key: 'dentist', kind: 'New', updated_at: '2' }]);
    expect(resolveKind(dentist, c)).toBe('New');
  });
});

describe('snapshots and labels', () => {
  it('captures what the event was at the time', () => {
    const s = snapshotOf(dentist, at('07:00'), '2026-11-20', ctx([{ series_key: 'dentist', kind: 'Appointment', title_override: 'Dentist (check-up)' }]));
    expect(s).toMatchObject({ key: 'dentist', title: 'Dentist (check-up)', kind: 'Appointment', relation: 'upcoming', offset_min: 180 });
  });
  it('describes timing plainly', () => {
    expect(relationLabel({ relation: 'upcoming', offset_min: 180 })).toBe('in 3 hours');
    expect(relationLabel({ relation: 'recent', offset_min: -45 })).toBe('45 min ago');
    expect(relationLabel({ relation: 'now', offset_min: 0 })).toBe('now');
  });
});
