import { Link } from 'react-router';
import { useCheckIns, usePeriods } from '../data/hooks';
import type { Period } from '../data/types';
import { deviceTimeZone, formatShortDate, wallClock } from '../lib/time';
import { describeSpan, periodsFor, periodStatus, type PeriodStatus } from '../lib/periods';

const GROUPS: { status: PeriodStatus; title: string }[] = [
  { status: 'active', title: 'Now' },
  { status: 'upcoming', title: 'Upcoming' },
  { status: 'past', title: 'Past' },
];

export function Periods() {
  const periods = usePeriods();
  const checkIns = useCheckIns() ?? [];
  const now = wallClock(new Date(), deviceTimeZone());
  const count = (p: Period) => checkIns.filter((c) => periodsFor(c, [p]).length > 0).length;

  return (
    <main className="page">
      <div className="page-head">
        <h1>Periods</h1>
        <span className="spacer" />
        <Link to="/periods/new" className="button">New period</Link>
      </div>
      {periods.length === 0 && (
        <p className="empty">
          Mark spans of time — a holiday, a busy week, an experiment — so you can compare them later.
        </p>
      )}
      {GROUPS.map((g) => {
        const items = periods.filter((p) => periodStatus(p, now.date, now.time) === g.status);
        if (g.status === 'past') items.reverse();
        if (!items.length) return null;
        return (
          <section key={g.status} className="section">
            <h2 className="section-title">{g.title}</h2>
            {items.map((p) => {
              const n = count(p);
              return (
                <Link key={p.id} to={`/periods/${p.id}`} className="period-pill">
                  <div className="title">
                    {p.title}
                    {p.category && <span className="category-badge">{p.category}</span>}
                  </div>
                  <div className="meta">
                    {describeSpan(p, formatShortDate)}
                    {g.status !== 'upcoming' && ` · ${n === 1 ? '1 check-in' : `${n} check-ins`}`}
                  </div>
                </Link>
              );
            })}
          </section>
        );
      })}
    </main>
  );
}
