import { useState } from 'react';
import type { CheckIn, Period } from '../data/types';
import { formatDayHeading } from '../lib/time';
import { useHealthByDay } from '../data/hooks';
import { summarise } from '../lib/healthDaily';
import { CheckInCard } from './CheckInCard';
import { HealthTags } from './HealthTags';

/**
 * Check-ins grouped by day (input must be newest first). In History each day
 * is a card: date, number of check-ins and that day's health tags, collapsed
 * until tapped (or open when `defaultOpen`, e.g. while searching). On Today
 * the heading and tags are shown by the screen itself.
 */
export function DayGroups({
  checkIns,
  periods,
  pending,
  showHeadings = true,
  defaultOpen = false,
}: {
  checkIns: CheckIn[];
  periods: Period[];
  pending: Set<string>;
  showHeadings?: boolean;
  defaultOpen?: boolean;
}) {
  const health = useHealthByDay();
  // Days the user has toggled away from the default.
  const [toggled, setToggled] = useState<Set<string>>(new Set());
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
  const toggle = (date: string) =>
    setToggled((prev) => {
      const next = new Set(prev);
      if (next.has(date)) next.delete(date);
      else next.add(date);
      return next;
    });

  return (
    <>
      {days.map((d) => {
        const open = defaultOpen !== toggled.has(d.date);
        const heading = formatDayHeading(d.date);
        const count = d.items.length === 1 ? '1 check-in' : `${d.items.length} check-ins`;
        const bodyId = `day-${d.date}`;
        return (
          <section key={d.date} className={open ? 'day-card open' : 'day-card'} aria-label={heading}>
            <div className="day-card-head">
              <button type="button" className="day-card-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => toggle(d.date)}>
                <h2 className="day-heading">{heading}</h2>
                <span className="day-count">{count}</span>
                <span className="day-chevron" aria-hidden="true" />
              </button>
              <HealthTags day={summarise(health.get(d.date))} showMissing={health.size > 0} />
            </div>
            {open && (
              <div id={bodyId} className="day-card-body">
                {d.items.map((c) => (
                  <CheckInCard key={c.id} c={c} periods={periods} pending={pending.has(c.id)} />
                ))}
              </div>
            )}
          </section>
        );
      })}
    </>
  );
}
