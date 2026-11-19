import { describe, expect, it } from 'vitest';
import type { CheckIn, Period } from '../data/types';
import { filterCheckIns, usedTags } from './filter';

const c = (o: Partial<CheckIn>): CheckIn => ({
  id: Math.random().toString(), observed_at: '', timezone: 'UTC', local_date: '2026-12-01', local_time: '10:00:00',
  mood: null, energy: null, anxiety: null, pressure: null, body_tags: [], context_tags: [], need_tags: [],
  thought: null, preceding: null, events: [], extra: {}, created_at: '', updated_at: '', ...o,
});

const list = [
  c({ local_date: '2026-11-28', context_tags: ['Work'], thought: 'I should finish the deck' }),
  c({ local_date: '2026-12-02', context_tags: ['Resting'], body_tags: ['Heavy'], preceding: 'Long meeting' }),
  c({ local_date: '2026-12-20', context_tags: ['Work', 'Meeting'] }),
];
const holiday: Period = {
  id: 'h', title: 'Holiday', description: null, category: null, start_date: '2026-11-30', start_time: null,
  end_date: '2026-12-14', end_time: null, extra: {}, created_at: '', updated_at: '',
};

describe('filterCheckIns', () => {
  it('searches thought, preceding and tags case-insensitively', () => {
    expect(filterCheckIns(list, { q: 'SHOULD' }, [])).toHaveLength(1);
    expect(filterCheckIns(list, { q: 'meeting' }, [])).toHaveLength(2);
  });
  it('filters by inclusive date range', () => {
    expect(filterCheckIns(list, { from: '2026-12-02', to: '2026-12-02' }, [])).toHaveLength(1);
  });
  it('filters by period membership', () => {
    expect(filterCheckIns(list, { periodId: 'h' }, [holiday]).map((x) => x.local_date)).toEqual(['2026-12-02']);
  });
  it('filters by tag', () => {
    expect(filterCheckIns(list, { tag: 'work' }, [])).toHaveLength(2);
  });
  it('lists used tags by frequency', () => {
    expect(usedTags(list)[0]).toBe('Work');
  });
});
