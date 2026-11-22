import { useState } from 'react';
import { Link } from 'react-router';
import type { CheckIn, Period } from '../data/types';
import { formatTime, deviceTimeZone } from '../lib/time';
import { levelLabel, MEASURES, TAG_GROUPS } from '../lib/vocabulary';
import { relationLabel, timeLabel } from '../lib/calendar';
import { pressureReason } from '../lib/extra';
import { wallClock } from '../lib/time';

/** When a check-in was written well after the moment it describes, say so (e.g. "09:12" or "21 Nov, 09:12"). */
function recordedLater(c: CheckIn): string | null {
  const gap = Date.parse(c.created_at) - Date.parse(c.observed_at);
  if (!(gap > 15 * 60000)) return null;
  const at = wallClock(new Date(c.created_at), c.timezone);
  const time = at.time.slice(0, 5);
  if (at.date === c.local_date) return time;
  const d = new Date(`${at.date}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `${d}, ${time}`;
}
import { periodsFor } from '../lib/periods';
import { removeCheckIn } from '../data/actions';
import { ConfirmDialog } from './ConfirmDialog';
import { Meters } from './Meters';

/** One observation: compact summary, tap to expand into the full record. */
export function CheckInCard({ c, periods, pending }: { c: CheckIn; periods: Period[]; pending?: boolean }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const tags = [...c.context_tags, ...c.body_tags, ...c.need_tags];
  const inPeriods = periodsFor(c, periods);
  const otherZone = c.timezone !== deviceTimeZone();

  return (
    <article className={open ? 'card open' : 'card'}>
      <button type="button" className="card-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="card-time">
          {formatTime(c.local_time)}
          {pending && <span className="pending-dot" title="Waiting to sync" aria-label="Waiting to sync" />}
        </span>
        <span className="card-main">
          <Meters c={c} />
          {c.thought && <span className={open ? 'card-thought' : 'card-thought clamp'}>{c.thought}</span>}
          {!open && tags.length > 0 && <span className="card-tags">{tags.join(' · ')}</span>}
        </span>
      </button>

      {open && (
        <div className="card-detail">
          <dl className="detail-list">
            {MEASURES.filter((m) => c[m.key] != null || (m.key === 'pressure' && pressureReason(c))).map((m) => (
              <div key={m.key}>
                <dt>{m.label}</dt>
                <dd>
                  {levelLabel(m.key, c[m.key])}
                  {m.key === 'pressure' && pressureReason(c) && (
                    <span className="faint">
                      {c[m.key] != null ? ' · ' : ''}
                      {pressureReason(c)}
                    </span>
                  )}
                </dd>
              </div>
            ))}
            {TAG_GROUPS.filter((g) => c[g.column].length > 0).map((g) => (
              <div key={g.kind}>
                <dt>{g.title}</dt>
                <dd>{c[g.column].join(', ')}</dd>
              </div>
            ))}
            {(c.events ?? []).length > 0 && (
              <div>
                <dt>Calendar</dt>
                <dd>
                  <ul className="plain-list">
                    {c.events.map((e) => (
                      <li key={e.key}>
                        {e.title ?? 'Untitled event'}
                        <span className="faint">
                          {' '}
                          · {e.all_day ? timeLabel(e, c.timezone) : `${timeLabel(e, c.timezone)}, ${relationLabel(e)}`}
                          {e.kind && ` · ${e.kind}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                </dd>
              </div>
            )}
            {c.preceding && (
              <div>
                <dt>Just before</dt>
                <dd className="reflective">{c.preceding}</dd>
              </div>
            )}
            {inPeriods.length > 0 && (
              <div>
                <dt>Periods</dt>
                <dd>{inPeriods.map((p) => p.title).join(', ')}</dd>
              </div>
            )}
            {recordedLater(c) && (
              <div>
                <dt>Recorded</dt>
                <dd className="faint">Later, at {recordedLater(c)}</dd>
              </div>
            )}
            {otherZone && (
              <div>
                <dt>Time zone</dt>
                <dd>{c.timezone}</dd>
              </div>
            )}
          </dl>
          <div className="row">
            <Link className="button" to={`/check-in/${c.id}`}>Edit</Link>
            <span className="spacer" />
            <button type="button" className="button quiet danger" onClick={() => setConfirming(true)}>Delete</button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title="Delete this check-in?"
        body="It will be permanently removed from this device and from your account. This can’t be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          void removeCheckIn(c.id);
        }}
      />
    </article>
  );
}
