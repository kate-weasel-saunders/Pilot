import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { useCheckIns, usePendingIds, usePeriods } from '../data/hooks';
import { deviceTimeZone, formatDayHeading, wallClock } from '../lib/time';
import { periodStatus } from '../lib/periods';
import { DayGroups } from '../components/DayGroups';
import { SyncNote } from '../components/SyncNote';

function dayNumber(start: string, today: string) {
  return Math.round((Date.parse(today) - Date.parse(start)) / 86400000) + 1;
}

export function Today() {
  const location = useLocation();
  const navigate = useNavigate();
  const checkIns = useCheckIns();
  const periods = usePeriods();
  const pending = usePendingIds();
  const [toast, setToast] = useState(Boolean((location.state as { saved?: boolean } | null)?.saved));

  useEffect(() => {
    if (!toast) return;
    navigate('.', { replace: true, state: null });
    const t = setTimeout(() => setToast(false), 2200);
    return () => clearTimeout(t);
  }, [toast, navigate]);

  const now = wallClock(new Date(), deviceTimeZone());
  const todays = (checkIns ?? []).filter((c) => c.local_date === now.date);
  const active = periods.filter((p) => periodStatus(p, now.date, now.time) === 'active');
  const dateLine = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <main className="page">
      <div className="page-head">
        <h1 className="date-title">{dateLine}</h1>
        <span className="spacer" />
        <Link to="/settings" className="button quiet small">Settings</Link>
      </div>

      {active.length > 0 && (
        <p className="muted" style={{ marginBottom: 'var(--s-4)' }}>
          {active.map((p, i) => (
            <span key={p.id}>
              {i > 0 && ' · '}
              <Link to={`/periods/${p.id}`} className="inherit-link">{p.title}</Link>
              <span className="faint">
                {' '}
                day {dayNumber(p.start_date, now.date)}
                {p.end_date ? ` of ${dayNumber(p.start_date, p.end_date)}` : ''}
              </span>
            </span>
          ))}
        </p>
      )}

      <Link to="/check-in" className="button primary checkin-cta">Check in</Link>

      <div className="section">
        <SyncNote />
        {checkIns === undefined ? null : todays.length === 0 ? (
          <p className="empty">Nothing yet today.</p>
        ) : (
          <>
            <h2 className="section-title">{formatDayHeading(now.date)}</h2>
            <DayGroups checkIns={todays} periods={periods} pending={pending} showHeadings={false} />
          </>
        )}
      </div>

      {toast && <div className="toast" role="status">Saved</div>}
    </main>
  );
}
