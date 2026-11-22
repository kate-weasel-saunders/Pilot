import type { DayHealth } from '../lib/healthDaily';
import { formatMinutes } from '../lib/health';

/** Quiet, factual health tags for a day. Renders nothing if there's no data. */
export function HealthTags({ day }: { day: DayHealth | null | undefined }) {
  if (!day) return null;
  const tags: { key: string; text: string; label: string }[] = [];
  if (day.sleepMin !== null) tags.push({ key: 'sleep', text: `Sleep ${formatMinutes(day.sleepMin)}`, label: `Slept ${formatMinutes(day.sleepMin)} the night before` });
  if (day.hrv !== null) tags.push({ key: 'hrv', text: `HRV ${Math.round(day.hrv)} ms`, label: `Average heart rate variability ${Math.round(day.hrv)} milliseconds` });
  if (day.restingHr !== null) tags.push({ key: 'rhr', text: `Resting HR ${Math.round(day.restingHr)}`, label: `Resting heart rate ${Math.round(day.restingHr)} beats per minute` });
  if (day.activeMin !== null) tags.push({ key: 'active', text: `Active ${formatMinutes(day.activeMin)}`, label: `Active for ${formatMinutes(day.activeMin)}` });
  if (day.mindfulMin !== null) tags.push({ key: 'mindful', text: `Mindful ${formatMinutes(day.mindfulMin)}`, label: `Mindful sessions ${formatMinutes(day.mindfulMin)}` });
  if (!tags.length) return null;
  return (
    <ul className="health-tags" aria-label="Health">
      {tags.map((t) => (
        <li key={t.key} aria-label={t.label}>
          {t.text}
        </li>
      ))}
    </ul>
  );
}
