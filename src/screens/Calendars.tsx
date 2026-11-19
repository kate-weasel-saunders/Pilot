import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useCalendarSources, useTags } from '../data/hooks';
import { removeCalendarSource, saveCalendarSource, saveTag } from '../data/actions';
import { addCalendar, CalendarError, refreshCalendars, replaceCalendarLink } from '../data/calendarController';
import { syncNow } from '../data/syncController';
import { newId } from '../data/repo';
import type { CalendarSource } from '../data/types';
import { chipsFor, cleanLabel, hasLabel } from '../lib/vocabulary';
import { ConfirmDialog } from '../components/ConfirmDialog';

function KindChips({ value, onChange, kinds, onAdd }: { value: string | null; onChange: (k: string | null) => void; kinds: string[]; onAdd: (l: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');
  const add = () => {
    const label = cleanLabel(text);
    setAdding(false);
    setText('');
    if (!label) return;
    if (!hasLabel(kinds, label)) onAdd(label);
    onChange(label);
  };
  return (
    <div className="chip-list" role="radiogroup" aria-label="Default kind">
      {kinds.map((k) => (
        <button key={k} type="button" role="radio" aria-checked={value === k} aria-pressed={value === k} className="chip" onClick={() => onChange(value === k ? null : k)}>
          {k}
        </button>
      ))}
      {adding ? (
        <span className="chip-add">
          <input autoFocus aria-label="New kind" value={text} maxLength={60} onChange={(e) => setText(e.target.value)} onBlur={add} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} />
        </span>
      ) : (
        <button type="button" className="chip chip-new" onClick={() => setAdding(true)}>+ Other</button>
      )}
    </div>
  );
}

export function Calendars() {
  const navigate = useNavigate();
  const sources = useCalendarSources();
  const tags = useTags();
  const kinds = chipsFor('event', tags);
  const addKind = (label: string) =>
    void saveTag({ id: newId(), kind: 'event', label, hidden: false, sort_order: tags.length, created_at: new Date().toISOString(), updated_at: '' });

  const [name, setName] = useState('');
  const [link, setLink] = useState('');
  const [kind, setKind] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<CalendarSource | null>(null);

  const run = async (fn: () => Promise<string>): Promise<boolean> => {
    setBusy(true);
    setMessage(null);
    try {
      setMessage({ text: await fn() });
      await syncNow();
      return true;
    } catch (e) {
      setMessage({ text: e instanceof CalendarError ? e.message : 'Something went wrong. Try again.', error: true });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !link.trim()) return setMessage({ text: 'Add a name and the calendar’s link.', error: true });
    void run(async () => {
      const res = await addCalendar(name.trim(), link.trim(), kind);
      setName('');
      setLink('');
      setKind(null);
      return `Added “${res.source.name}”. ${res.refresh.events} event${res.refresh.events === 1 ? '' : 's'} imported across your calendars.`;
    });
  };

  return (
    <main className="page">
      <div className="page-head">
        <h1>Calendars</h1>
        <span className="spacer" />
        <button type="button" className="button quiet" onClick={() => navigate(-1)}>Done</button>
      </div>

      <p className="muted small">
        Events from the last week and next two weeks are imported, and the ones around each check-in are attached to it. Only titles and times
        are kept. Links are stored on the server, never on this device.
      </p>

      {sources && sources.length > 0 && (
        <section className="section">
          <div className="row">
            <h2 className="section-title">Your calendars</h2>
            <span className="spacer" />
            <button type="button" className="button quiet small" disabled={busy} onClick={() => void run(async () => `Refreshed. ${(await refreshCalendars()).events} events.`)}>
              Refresh now
            </button>
          </div>
          {sources.map((s) => (
            <SourceRow
              key={s.id}
              source={s}
              kinds={kinds}
              onAddKind={addKind}
              open={editing === s.id}
              busy={busy}
              onToggle={() => setEditing(editing === s.id ? null : s.id)}
              onRemove={() => setRemoving(s)}
              onReplaceLink={(url) => run(async () => `Link updated. ${(await replaceCalendarLink(s.id, url)).refresh.events} events.`)}
            />
          ))}
        </section>
      )}

      <section className="section">
        <h2 className="section-title">Add a calendar</h2>
        <form className="stack" onSubmit={add}>
          <label className="field">
            <span>Name</span>
            <input value={name} maxLength={100} placeholder="e.g. Kate & Neil" onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="field">
            <span>Secret calendar link (iCal / ICS)</span>
            <input value={link} type="url" inputMode="url" autoComplete="off" autoCapitalize="off" spellCheck={false} placeholder="https://calendar.google.com/calendar/ical/…" onChange={(e) => setLink(e.target.value)} />
          </label>
          <div>
            <p className="field-label">Usual kind of event (optional)</p>
            <KindChips value={kind} onChange={setKind} kinds={kinds} onAdd={addKind} />
          </div>
          {message && (
            <p className={message.error ? 'error' : 'muted small'} role={message.error ? 'alert' : 'status'}>
              {message.text}
            </p>
          )}
          <button className="button primary" disabled={busy}>{busy ? 'Checking the link…' : 'Add calendar'}</button>
        </form>

        <details className="more section">
          <summary>Where do I find the link?</summary>
          <div className="stack small muted help">
            <p>
              <strong>Google Calendar</strong> (on a computer): Settings → choose the calendar under “Settings for my calendars” → Integrate calendar →
              copy <em>Secret address in iCal format</em>.
            </p>
            <p>
              <strong>Outlook / Microsoft 365</strong>: Outlook on the web → Settings → Calendar → Shared calendars → Publish a calendar → choose the
              calendar and “Can view titles and locations” → Publish → copy the <em>ICS</em> link. If publishing isn’t available, your organisation has
              switched it off.
            </p>
            <p>Treat these links like passwords. If one ever leaks, reset it in Google or Outlook and paste the new one here.</p>
          </div>
        </details>
      </section>

      <ConfirmDialog
        open={removing !== null}
        title={`Remove “${removing?.name ?? ''}”?`}
        body="Its link is deleted from the server and its events stop being imported. Events already attached to check-ins are kept."
        confirmLabel="Remove"
        onCancel={() => setRemoving(null)}
        onConfirm={async () => {
          if (removing) await removeCalendarSource(removing.id);
          setRemoving(null);
          setEditing(null);
        }}
      />
    </main>
  );
}

function SourceRow({
  source,
  kinds,
  onAddKind,
  open,
  busy,
  onToggle,
  onRemove,
  onReplaceLink,
}: {
  source: CalendarSource;
  kinds: string[];
  onAddKind: (l: string) => void;
  open: boolean;
  busy: boolean;
  onToggle: () => void;
  onRemove: () => void;
  onReplaceLink: (url: string) => Promise<boolean>;
}) {
  const [link, setLink] = useState('');
  const update = (patch: Partial<CalendarSource>) => void saveCalendarSource({ ...source, ...patch });
  const status = source.last_error
    ? source.last_error
    : source.last_refreshed_at
      ? `Updated ${new Date(source.last_refreshed_at).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}`
      : 'Not imported yet';

  return (
    <div className="source">
      <button type="button" className="source-summary" aria-expanded={open} onClick={onToggle}>
        <span className="source-name">{source.name}</span>
        <span className={source.last_error ? 'source-status warn' : 'source-status'}>
          {!source.enabled ? 'Paused' : status}
          {source.default_kind && ` · ${source.default_kind}`}
        </span>
      </button>
      {open && (
        <div className="stack source-edit">
          <label className="field">
            <span>Name</span>
            <input defaultValue={source.name} maxLength={100} onBlur={(e) => e.target.value.trim() && e.target.value.trim() !== source.name && update({ name: e.target.value.trim() })} />
          </label>
          <div>
            <p className="field-label">Usual kind of event</p>
            <KindChips value={source.default_kind} onChange={(k) => update({ default_kind: k })} kinds={kinds} onAdd={onAddKind} />
          </div>
          <label className="row small">
            <input type="checkbox" checked={source.enabled} onChange={(e) => update({ enabled: e.target.checked })} /> Import from this calendar
          </label>
          <label className="field">
            <span>Replace link (if you reset it)</span>
            <input value={link} type="url" autoComplete="off" autoCapitalize="off" spellCheck={false} onChange={(e) => setLink(e.target.value)} />
          </label>
          <div className="row">
            <button type="button" className="button" disabled={busy || !link.trim()} onClick={() => void onReplaceLink(link.trim()).then((ok) => ok && setLink(''))}>
              Save new link
            </button>
            <span className="spacer" />
            <button type="button" className="button quiet danger" onClick={onRemove}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}
