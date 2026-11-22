import { describe, expect, it } from 'vitest';
import type { CheckIn } from '../data/types';
import { buildCheckInsCsv, buildJsonExport, csvCell } from './export';

const c: CheckIn = {
  id: '1', observed_at: '2026-12-01T09:30:00.000Z', timezone: 'Europe/London', local_date: '2026-12-01', local_time: '09:30:00',
  mood: 2, energy: 1, anxiety: 4, pressure: null, body_tags: ['Heavy', 'Foggy'], context_tags: ['Work'], need_tags: [],
  thought: 'He said "fine", but\nit wasn’t', preceding: null, events: [], extra: {}, created_at: 'x', updated_at: 'y',
};

describe('csv', () => {
  it('escapes quotes, commas and newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell(null)).toBe('');
    expect(csvCell(['a', 'b'])).toBe('a; b');
  });
  it('neutralises spreadsheet formulas', () => {
    expect(csvCell('=SUM(A1)')).toBe("'=SUM(A1)");
  });
  it('includes derived columns', () => {
    const csv = buildCheckInsCsv([c], []);
    const [header, row] = csv.split('\r\n');
    expect(header).toContain('weekday,part_of_day');
    expect(header).toContain('pressure,pressure_reason,body_tags');
    expect(row).toContain('Tuesday,morning,2,1,4,,,Heavy; Foggy,Work,');
    expect(csv).toContain('"He said ""fine"", but\nit wasn’t"');
  });
});

describe('events in exports', () => {
  it('describes attached events in the CSV', () => {
    const withEvents: CheckIn = {
      ...c,
      events: [{ key: 'k', series_key: 's', title: 'Dentist', kind: 'Appointment', all_day: false, starts_at: '2026-12-01T10:00:00Z',
        ends_at: '2026-12-01T10:30:00Z', start_date: null, end_date: null, relation: 'upcoming', offset_min: 30 }],
    };
    expect(buildCheckInsCsv([withEvents], [])).toContain('Dentist [Appointment] (upcoming, 30 min)');
  });
  it('never exports calendar links', () => {
    const out = buildJsonExport({ check_ins: [], periods: [], tags: [], calendar_sources: [{ id: '1', name: 'Home', default_kind: null, enabled: true,
      last_refreshed_at: null, last_error: null, created_at: '', updated_at: '', ...({ feed_url: 'https://secret' } as object) }] });
    expect(out).not.toContain('secret');
    expect(JSON.parse(out).calendar_sources[0].name).toBe('Home');
  });
});

describe('json', () => {
  it('is versioned and round-trips', () => {
    const out = JSON.parse(buildJsonExport({ check_ins: [c], periods: [], tags: [] }, new Date('2026-12-02T00:00:00Z')));
    expect(out.format).toBe('pilot-export');
    expect(out.version).toBe(1);
    expect(out.check_ins[0]).toEqual(c);
  });
});
