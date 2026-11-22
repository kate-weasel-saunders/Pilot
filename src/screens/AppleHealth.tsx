import { useCallback, useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';
import { env } from '../lib/env';
import { db } from '../data/db';
import { syncNow } from '../data/syncController';
import { formatMinutes } from '../lib/health';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ShortcutGuide } from '../components/ShortcutGuide';

interface KeyRow {
  id: string;
  label: string;
  created_at: string;
  last_used_at: string | null;
  last_summary: string | null;
}

const when = (iso: string) => new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const healthEndpoint = () => `${env.supabaseUrl.replace(/\/$/, '')}/functions/v1/health`;

async function errorText(error: unknown): Promise<string> {
  const res = (error as { context?: unknown }).context;
  if (res instanceof Response) {
    try {
      const body = await res.clone().json();
      if (body?.error) return body.error;
    } catch {
      // ignore
    }
    return `Pilot’s server returned HTTP ${res.status}.`;
  }
  return navigator.onLine ? 'Couldn’t reach Pilot’s server. Has the health function been deployed?' : 'You’re offline.';
}

function CopyField({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="field">
      <span>{label}</span>
      <div className="row">
        <input readOnly value={value} onFocus={(e) => e.target.select()} aria-label={label} className="mono" />
        <button
          type="button"
          className="button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(value);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            } catch {
              // Clipboard blocked: the field is selectable as a fallback.
            }
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
    </div>
  );
}

export function AppleHealth() {
  const navigate = useNavigate();
  const [keys, setKeys] = useState<KeyRow[] | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [revoking, setRevoking] = useState<KeyRow | null>(null);
  const [wiping, setWiping] = useState(false);

  const latest = useLiveQuery(async () => {
    const all = await db.health_samples.orderBy('starts_at').reverse().limit(400).toArray();
    const pick = (m: string) => all.find((s) => s.metric === m);
    return { count: await db.health_samples.count(), sleep: pick('sleep'), workout: pick('workout'), mindful: pick('mindful'), hrv: pick('hrv'), resting: pick('resting_hr') };
  }, []);

  const loadKeys = useCallback(async () => {
    if (!supabase) return;
    const { data, error } = await supabase.from('health_ingest_keys').select('id, label, created_at, last_used_at, last_summary').order('created_at');
    if (error) setMessage({ text: navigator.onLine ? 'Couldn’t load your keys. Has the health migration been run?' : 'You’re offline.', error: true });
    else setKeys(data as KeyRow[]);
  }, []);

  useEffect(() => {
    // Async load; state is set when the request resolves.
    void loadKeys(); // eslint-disable-line react-hooks/set-state-in-effect
  }, [loadKeys]);

  const createKey = async () => {
    if (!supabase) return;
    setBusy(true);
    setMessage(null);
    const { data, error } = await supabase.functions.invoke('health', { body: { action: 'create_key', label: 'iPhone Shortcut' } });
    setBusy(false);
    if (error) return setMessage({ text: await errorText(error), error: true });
    setNewKey((data as { key: string }).key);
    void loadKeys();
  };

  return (
    <main className="page">
      <div className="page-head">
        <h1>Apple Health</h1>
        <span className="spacer" />
        <button type="button" className="button quiet" onClick={() => navigate(-1)}>Done</button>
      </div>

      <p className="muted small">
        A Shortcut on your iPhone sends active time, mindful sessions, sleep, HRV and resting heart rate to Pilot. Recent active periods,
        mindful sessions and last night’s sleep appear under “Happening around this time” when you check in. Only summaries are sent: no routes, no second-by-second heart rate.
      </p>

      {latest && latest.count > 0 && (
        <section className="section">
          <h2 className="section-title">Latest received</h2>
          <dl className="detail-list">
            {latest.sleep && (
              <div>
                <dt>Sleep</dt>
                <dd>{formatMinutes(latest.sleep.value ?? 0)}, ending {when(latest.sleep.ends_at)}</dd>
              </div>
            )}
            {latest.workout && (
              <div>
                <dt>Active time</dt>
                <dd>
                  {latest.workout.label && latest.workout.label !== 'Exercise' ? `${latest.workout.label}, ` : ''}
                  {formatMinutes(latest.workout.value ?? 0)}, {when(latest.workout.starts_at)}
                </dd>
              </div>
            )}
            {latest.mindful && (
              <div>
                <dt>Mindful</dt>
                <dd>{formatMinutes(latest.mindful.value ?? 0)}, {when(latest.mindful.starts_at)}</dd>
              </div>
            )}
            {latest.hrv && (
              <div>
                <dt>HRV</dt>
                <dd>{latest.hrv.value} ms, {when(latest.hrv.starts_at)}</dd>
              </div>
            )}
            {latest.resting && (
              <div>
                <dt>Resting heart rate</dt>
                <dd>{latest.resting.value} bpm, {when(latest.resting.starts_at)}</dd>
              </div>
            )}
          </dl>
        </section>
      )}

      <section className="section">
        <h2 className="section-title">Shortcut key</h2>
        {newKey ? (
          <div className="stack key-reveal">
            <p className="small">
              <strong>Copy this key now.</strong> It’s shown only once. Paste it into the Shortcut (step 7 of the guide below). Treat it like a
              password; you can revoke it here at any time.
            </p>
            <CopyField label="Key" value={newKey} />
            <CopyField label="Web address (URL)" value={healthEndpoint()} />
            <button type="button" className="button quiet" onClick={() => setNewKey(null)}>I’ve copied it</button>
          </div>
        ) : (
          <div className="stack">
            {keys?.map((k) => (
              <div key={k.id} className="source">
                <div className="source-summary as-row">
                  <span className="source-name">{k.label}</span>
                  <span className="source-status">
                    {k.last_used_at ? `Last sent ${when(k.last_used_at)}` : `Created ${when(k.created_at)} · nothing received yet`}
                  </span>
                  {k.last_summary && <span className="source-status">{k.last_summary}</span>}
                </div>
                <button type="button" className="button quiet danger small" onClick={() => setRevoking(k)}>Revoke</button>
              </div>
            ))}
            <CopyField label="Web address (URL) for the Shortcut" value={healthEndpoint()} />
            <button type="button" className="button primary" disabled={busy} onClick={createKey}>
              {busy ? 'Creating…' : keys?.length ? 'Create another key' : 'Create a key'}
            </button>
          </div>
        )}
        {message && (
          <p className={message.error ? 'error' : 'muted small'} role={message.error ? 'alert' : 'status'}>
            {message.text}
          </p>
        )}
      </section>

      <details className="more section" open={!keys?.some((k) => k.last_used_at)}>
        <summary>How to set up the Shortcut</summary>
        <ShortcutGuide />
      </details>

      {latest && latest.count > 0 && (
        <section className="section">
          <button type="button" className="button quiet danger" onClick={() => setWiping(true)}>Delete all imported health data</button>
        </section>
      )}

      <ConfirmDialog
        open={revoking !== null}
        title="Revoke this key?"
        body="The Shortcut using it will stop working until you give it a new key. Data already received is kept."
        confirmLabel="Revoke"
        onCancel={() => setRevoking(null)}
        onConfirm={async () => {
          if (revoking && supabase) await supabase.from('health_ingest_keys').delete().eq('id', revoking.id);
          setRevoking(null);
          void loadKeys();
        }}
      />
      <ConfirmDialog
        open={wiping}
        title="Delete all imported health data?"
        body="Active time, mindful sessions, sleep, HRV and heart rate received from Apple Health are permanently removed from Pilot. Check-ins keep the items already attached to them. Apple Health itself isn’t affected."
        confirmLabel="Delete"
        onCancel={() => setWiping(false)}
        onConfirm={async () => {
          setWiping(false);
          if (!supabase) return;
          const { error } = await supabase.from('health_samples').delete().not('id', 'is', null);
          if (error) return setMessage({ text: 'Couldn’t delete right now. Try again when online.', error: true });
          await syncNow();
          setMessage({ text: 'Imported health data deleted.' });
        }}
      />
    </main>
  );
}
