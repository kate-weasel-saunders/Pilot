import { useEffect, useState } from 'react';
import { runHealthShortcut, SHORTCUT_NAME } from '../lib/healthShortcut';
import { useSyncState } from '../data/syncController';
import { sinceLabel } from '../lib/time';

/** Runs the Send to Pilot Shortcut (phone unlocked, so Health can be read), with when it last sent data. */
export function UpdateHealthButton({ variant = 'quiet' }: { variant?: 'quiet' | 'full' }) {
  const { healthSentAt } = useSyncState();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const since = healthSentAt ? sinceLabel(healthSentAt, now) : null;

  if (variant === 'full') {
    return (
      <div className="stack update-health-full">
        <button type="button" className="button wide" onClick={runHealthShortcut} aria-label={`Update health data (runs your ${SHORTCUT_NAME} Shortcut)`}>
          Update health data now
        </button>
        {since && <p className="faint small">Last synced {since}</p>}
      </div>
    );
  }
  return (
    <span className="update-health-wrap">
      <button type="button" className="button quiet small update-health" onClick={runHealthShortcut} aria-label={`Update health data (runs your ${SHORTCUT_NAME} Shortcut)`}>
        ↻ Update
      </button>
      {since && <span className="faint update-health-since">Synced {since}</span>}
    </span>
  );
}
