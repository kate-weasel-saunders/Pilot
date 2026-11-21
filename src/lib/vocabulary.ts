import type { MeasureKey, Tag, TagKind } from '../data/types';

/**
 * Scales and default chips. Edit freely: stored data keeps whatever labels
 * were chosen at the time, so changing defaults never rewrites history.
 */

export interface Measure {
  key: MeasureKey;
  label: string;
  /** Words for 1..5. The ends are what the scale is anchored on. */
  levels: [string, string, string, string, string];
}

export const MEASURES: Measure[] = [
  { key: 'mood', label: 'Mood', levels: ['Very low', 'Low', 'Okay', 'Good', 'Very good'] },
  { key: 'energy', label: 'Energy', levels: ['Empty', 'Low', 'Some', 'Good', 'Energised'] },
  { key: 'anxiety', label: 'Anxiety / tension', levels: ['Calm', 'A little tense', 'Tense', 'Anxious', 'Very anxious'] },
  { key: 'pressure', label: 'Pressure / demand', levels: ['None', 'A little', 'Some', 'A lot', 'Overwhelmed'] },
];

export function levelLabel(key: MeasureKey, score: number | null): string | null {
  if (score == null) return null;
  return MEASURES.find((m) => m.key === key)?.levels[score - 1] ?? null;
}

export interface TagGroup {
  kind: TagKind;
  title: string;
  column: 'body_tags' | 'context_tags' | 'need_tags';
  defaults: string[];
}

export const TAG_GROUPS: TagGroup[] = [
  {
    kind: 'body',
    title: 'Body',
    column: 'body_tags',
    defaults: ['Heavy', 'Sleepy', 'Foggy', 'Tense', 'Restless', 'Wired', 'Drained', 'Calm', 'Comfortable', 'Energetic', 'Headache / physically off'],
  },
  {
    kind: 'context',
    title: 'What’s happening',
    column: 'context_tags',
    defaults: [
      'Work', 'Meeting', 'Creative / game', 'Resting', 'TV', 'Cooking', 'Exercise', 'Walking', 'Chores / admin',
      'Socialising', 'Travelling', 'Alone', 'With partner / family', 'Outdoors', 'Just woke up', 'Going to bed',
    ],
  },
  {
    kind: 'need',
    title: 'What I need or want',
    column: 'need_tags',
    defaults: [
      'Nothing / no demands', 'Sleep', 'Rest', 'Escape', 'Solitude', 'Comfort', 'Quiet', 'Movement', 'Stimulation',
      'Creativity', 'Connection', 'Achievement', 'Reassurance', 'Food', 'Outside / nature', 'Unsure',
    ],
  },
];

/** Kinds of calendar event. Custom kinds are added via "+ Other" (tags of kind 'event'). */
export const EVENT_KINDS = ['Work', 'Meeting', 'Social', 'Family', 'Appointment', 'Travel', 'Exercise', 'Mindful', 'Sleep', 'Personal'];

const DEFAULTS: Record<TagKind, string[]> = {
  body: TAG_GROUPS[0]!.defaults,
  context: TAG_GROUPS[1]!.defaults,
  need: TAG_GROUPS[2]!.defaults,
  event: EVENT_KINDS,
};

export const PERIOD_CATEGORIES = ['Holiday', 'Work', 'Break', 'Experiment', 'Social', 'Health', 'Other'];

const norm = (s: string) => s.trim().toLocaleLowerCase();

/**
 * The chips to show for a group: defaults (minus hidden ones), then custom
 * tags, then any labels already on the entry being edited that aren't in the
 * vocabulary any more (so editing never silently drops a tag).
 */
export function chipsFor(kind: TagKind, tags: Tag[], selected: string[] = []): string[] {
  const mine = tags.filter((t) => t.kind === kind);
  const hidden = new Set(mine.filter((t) => t.hidden).map((t) => norm(t.label)));
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    const k = norm(label);
    if (!k || seen.has(k)) return;
    seen.add(k);
    out.push(label);
  };
  DEFAULTS[kind].filter((d) => !hidden.has(norm(d))).forEach(push);
  mine
    .filter((t) => !t.hidden)
    .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
    .forEach((t) => push(t.label));
  selected.forEach(push);
  return out;
}

/** Clean up a user-typed tag label. Returns null if it's not usable. */
export function cleanLabel(input: string): string | null {
  const s = input.replace(/\s+/g, ' ').trim().slice(0, 60);
  return s ? s : null;
}

export function hasLabel(list: string[], label: string): boolean {
  return list.some((l) => norm(l) === norm(label));
}
