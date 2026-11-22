import type { CheckIn, Period } from '../data/types';
import { formatDayHeading } from '../lib/time';
import { useHealthByDay } from '../data/hooks';
import { summarise } from '../lib/healthDaily';
import { CheckInCard } from './CheckInCard';
import { HealthTags } from './HealthTags';

/**
 * Check-ins grouped by day (input must be newest first). In History each day
 * is a card headed by the date and that day's health tags; on Today the
 * heading and tags are shown by the screen itself.
 */
export function DayGroups({ checkIns, periods, pending, showHeadings = true }: { checkIns: CheckIn[]; periods: Period[]; pending: Set<string>; showHeadings?: boolean }) {
  const health = useHealthByDay();
  const days: { date: string; items: CheckIn[] }[] = [];
  for (const c of checkIns) {
    const last = days.at(-1);
    if (last && last.date === c.local_date) last.items.push(c);
    else days.push({ date: c.local_date, items: [c] });
  }
  if (!showHeadings) {
    return (
      <>
        {days.flatMap((d) => d.items).map((c) => (
          <CheckInCard key={c.id} c={c} periods={periods} pending={pending.has(c.id)} />
        ))}
      </>
    );
  }
  return (
    <>
      {days.map((d) => (
        <section key={d.date} className="day-card" aria-label={formatDayHeading(d.date)}>
          <header className="day-card-head">
            <h2 className="day-heading">{formatDayHeading(d.date)}</h2>
            <HealthTags day={summarise(health.get(d.date))} />
          </header>
          {d.items.map((c) => (
            <CheckInCard key={c.id} c={c} periods={periods} pending={pending.has(c.id)} />
          ))}
        </section>
      ))}
    </>
  );
}
