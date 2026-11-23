import type { DayHealth } from '../lib/healthDaily';
import { formatMinutes } from '../lib/health';

interface Tag {
  key: string;
  text: string;
  label: string;
  missing?: boolean;
}

/**
 * Quiet, factual health tags for a day. With `showMissing`, measures without
 * data appear as neutral grey "No … data" tags (never as zero, never as a warning).
 */
export function HealthTags({ day, showMissing = false }: { day: DayHealth | null | undefined; showMissing?: boolean }) {
  const d: DayHealth = day ?? { sleepMin: null, hrv: null, restingHr: null, activeMin: null, mindfulMin: null };
  const tag = (key: string, has: boolean, text: string, label: string, missingText: string): Tag | null =>
    has ? { key, text, label } : showMissing ? { key, text: missingText, label: `${missingText} for this day`, missing: true } : null;

  const tags = [
    tag('sleep', d.sleepMin !== null, `Sleep ${formatMinutes(d.sleepMin ?? 0)}`, `Slept ${formatMinutes(d.sleepMin ?? 0)} the night before`, 'No sleep data'),
    tag('hrv', d.hrv !== null, `HRV ${Math.round(d.hrv ?? 0)} ms`, `Average heart rate variability ${Math.round(d.hrv ?? 0)} milliseconds`, 'No HRV data'),
    tag('rhr', d.restingHr !== null, `Resting HR ${Math.round(d.restingHr ?? 0)}`, `Resting heart rate ${Math.round(d.restingHr ?? 0)} beats per minute`, 'No resting HR data'),
    tag('active', d.activeMin !== null, `Active ${formatMinutes(d.activeMin ?? 0)}`, `Active for ${formatMinutes(d.activeMin ?? 0)}`, 'No activity data'),
    tag('mindful', d.mindfulMin !== null, `Mindful ${formatMinutes(d.mindfulMin ?? 0)}`, `Mindful sessions ${formatMinutes(d.mindfulMin ?? 0)}`, 'No mindful data'),
  ].filter((t): t is Tag => t !== null);

  if (!tags.length) return null;
  return (
    <ul className="health-tags" aria-label="Health">
      {tags.map((t) => (
        <li key={t.key} aria-label={t.label} className={t.missing ? 'tag-missing' : `tag-${t.key}`}>
          {t.text}
        </li>
      ))}
    </ul>
  );
}
