import type { CheckIn, Period } from '../data/types';
import { formatDayHeading } from '../lib/time';
import { CheckInCard } from './CheckInCard';

/** Check-ins grouped under calm day headings (input must be newest first). */
export function DayGroups({ checkIns, periods, pending, showHeadings = true }: { checkIns: CheckIn[]; periods: Period[]; pending: Set<string>; showHeadings?: boolean }) {
  const days: { date: string; items: CheckIn[] }[] = [];
  for (const c of checkIns) {
    const last = days.at(-1);
    if (last && last.date === c.local_date) last.items.push(c);
    else days.push({ date: c.local_date, items: [c] });
  }
  return (
    <>
      {days.map((d) => (
        <section key={d.date} className={showHeadings ? 'day' : undefined} aria-label={formatDayHeading(d.date)}>
          {showHeadings && <h2 className="day-heading">{formatDayHeading(d.date)}</h2>}
          {d.items.map((c) => (
            <CheckInCard key={c.id} c={c} periods={periods} pending={pending.has(c.id)} />
          ))}
        </section>
      ))}
    </>
  );
}
