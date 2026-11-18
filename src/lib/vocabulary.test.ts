import { describe, expect, it } from 'vitest';
import type { Tag } from '../data/types';
import { chipsFor, cleanLabel } from './vocabulary';

const tag = (t: Partial<Tag>): Tag => ({ id: 'x', kind: 'body', label: 'X', hidden: false, sort_order: 0, created_at: '', updated_at: '', ...t });

describe('chipsFor', () => {
  it('starts from the defaults', () => {
    expect(chipsFor('body', [])[0]).toBe('Heavy');
  });

  it('hides defaults the user has hidden and appends custom tags', () => {
    const chips = chipsFor('body', [tag({ label: 'heavy', hidden: true }), tag({ label: 'Jaw clenched' })]);
    expect(chips).not.toContain('Heavy');
    expect(chips.at(-1)).toBe('Jaw clenched');
  });

  it('keeps labels already selected on an entry even if no longer in the vocabulary', () => {
    expect(chipsFor('need', [], ['Something old'])).toContain('Something old');
  });

  it('dedupes case-insensitively', () => {
    const chips = chipsFor('body', [tag({ label: 'HEAVY' })]);
    expect(chips.filter((c) => c.toLowerCase() === 'heavy')).toHaveLength(1);
  });
});

describe('cleanLabel', () => {
  it('trims and collapses whitespace', () => {
    expect(cleanLabel('  too   much  ')).toBe('too much');
    expect(cleanLabel('   ')).toBeNull();
  });
});
