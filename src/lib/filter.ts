import type { CheckIn, Period } from '../data/types';
import { containsWallClock } from './periods';

export interface HistoryFilter {
  q?: string;
  from?: string; // YYYY-MM-DD inclusive
  to?: string; // YYYY-MM-DD inclusive
  periodId?: string;
  tag?: string;
}

const norm = (s: string) => s.toLocaleLowerCase();

export function allTags(c: CheckIn): string[] {
  return [...c.body_tags, ...c.context_tags, ...c.need_tags];
}

export function filterCheckIns(list: CheckIn[], f: HistoryFilter, periods: Period[]): CheckIn[] {
  const q = f.q?.trim() ? norm(f.q.trim()) : null;
  const period = f.periodId ? periods.find((p) => p.id === f.periodId) : undefined;
  const tag = f.tag ? norm(f.tag) : null;
  return list.filter((c) => {
    if (f.from && c.local_date < f.from) return false;
    if (f.to && c.local_date > f.to) return false;
    if (f.periodId && (!period || !containsWallClock(period, c.local_date, c.local_time))) return false;
    if (tag && !allTags(c).some((t) => norm(t) === tag)) return false;
    if (q) {
      const hay = norm([c.thought ?? '', c.preceding ?? '', ...allTags(c)].join('\n'));
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

/** Tags that actually appear in the data, most used first. */
export function usedTags(list: CheckIn[]): string[] {
  const counts = new Map<string, number>();
  for (const c of list) for (const t of allTags(c)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([t]) => t);
}
