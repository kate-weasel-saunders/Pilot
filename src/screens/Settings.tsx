import { useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { db } from '../data/db';
import { syncNow, useSyncState } from '../data/syncController';
import { buildCheckInsCsv, buildJsonExport, buildPeriodsCsv } from '../lib/export';
import { deliverFile } from '../lib/download';
import { todayLocal } from '../lib/time';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function Settings() {
  const { session, signOut } = useAuth();
  const navigate = useNavigate();
  const sync = useSyncState();
  const pending = useLiveQuery(() => db.outbox.count(), [], 0);
  const [confirmSignOut, setConfirmSignOut] = useState(false);

  const load = async () => {
    await syncNow();
    const [check_ins, periods, tags, calendar_sources, event_series] = await Promise.all([
      db.check_ins.toArray(), db.periods.toArray(), db.tags.toArray(), db.calendar_sources.toArray(), db.event_series.toArray(),
    ]);
    return { check_ins, periods, tags, calendar_sources, event_series };
  };
  const stamp = todayLocal();

  return (
    <main className="page">
      <div className="page-head">
        <h1>Settings</h1>
        <span className="spacer" />
        <button type="button" className="button quiet" onClick={() => navigate(-1)}>Done</button>
      </div>

      <section className="section">
        <h2 className="section-title">Calendars</h2>
        <div className="stack">
          <p className="muted small">Attach events from Google or Outlook calendars to your check-ins.</p>
          <Link to="/settings/calendars" className="button">Manage calendars</Link>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Your data</h2>
        <div className="stack">
          <p className="muted small">
            Exports include everything Pilot holds about you. JSON is a complete backup; CSV opens in a spreadsheet.
          </p>
          <button type="button" className="button" onClick={async () => deliverFile(`pilot-${stamp}.json`, 'application/json', buildJsonExport(await load()))}>
            Export everything (JSON)
          </button>
          <button
            type="button"
            className="button"
            onClick={async () => {
              const d = await load();
              await deliverFile(`pilot-check-ins-${stamp}.csv`, 'text/csv', buildCheckInsCsv(d.check_ins, d.periods));
            }}
          >
            Export check-ins (CSV)
          </button>
          <button
            type="button"
            className="button"
            onClick={async () => deliverFile(`pilot-periods-${stamp}.csv`, 'text/csv', buildPeriodsCsv((await load()).periods))}
          >
            Export periods (CSV)
          </button>
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Sync</h2>
        <p className="muted small">
          {pending ? `${pending} change${pending === 1 ? '' : 's'} waiting to sync. ` : 'Everything on this device is synced. '}
          {sync.lastSyncedAt && `Last synced ${new Date(sync.lastSyncedAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}.`}
        </p>
      </section>

      <section className="section">
        <h2 className="section-title">Account</h2>
        <div className="stack">
          <p className="muted small">Signed in as {session?.user.email}</p>
          <button type="button" className="button" onClick={() => setConfirmSignOut(true)}>Sign out</button>
        </div>
      </section>

      <p className="faint small section">Pilot version {__APP_BUILD__}</p>

      <ConfirmDialog
        open={confirmSignOut}
        title="Sign out?"
        body={
          pending
            ? `${pending} change${pending === 1 ? ' hasn’t' : 's haven’t'} synced yet and will be lost if you sign out now. Signing out also removes Pilot’s data from this device.`
            : 'Signing out removes Pilot’s data from this device. It stays in your account.'
        }
        confirmLabel="Sign out"
        onCancel={() => setConfirmSignOut(false)}
        onConfirm={async () => {
          setConfirmSignOut(false);
          await signOut();
          navigate('/', { replace: true });
        }}
      />
    </main>
  );
}
