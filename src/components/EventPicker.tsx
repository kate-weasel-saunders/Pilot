import { useState } from 'react';
import type { CalendarEvent, EventSnapshot } from '../data/types';
import { displayTitle, relationLabel, relationTo, resolveKind, timeLabel, type EventContext } from '../lib/calendar';
import { cleanLabel, hasLabel } from '../lib/vocabulary';

interface Props {
  suggested: CalendarEvent[];
  others: CalendarEvent[];
  /** Selected snapshots, by event key. */
  selected: Map<string, EventSnapshot>;
  ctx: EventContext;
  at: Date;
  localDate: string;
  timeZone: string;
  kinds: string[];
  onToggle: (e: CalendarEvent | EventSnapshot, on: boolean) => void;
  onSetKind: (seriesKey: string, kind: string | null) => void;
  onAddKind: (label: string) => void;
  onSetHidden: (seriesKey: string, hidden: boolean) => void;
}

type Row = { key: string; series_key: string; title: string; time: string; when: string; kind: string | null; event?: CalendarEvent; snapshot?: EventSnapshot };

/**
 * "Around now": calendar events for this check-in. Collapsed to one line so
 * capture stays fast; expands into a checklist with kinds.
 */
export function EventPicker(p: Props) {
  const [open, setOpen] = useState(false);
  const [kindFor, setKindFor] = useState<string | null>(null);

  const toRow = (e: CalendarEvent): Row => ({
    key: e.event_key,
    series_key: e.series_key,
    title: displayTitle(e, p.ctx),
    time: timeLabel(e, p.timeZone),
    when: relationLabel(relationTo(e, p.at, p.localDate)),
    kind: resolveKind(e, p.ctx),
    event: e,
  });
  const candidateKeys = new Set([...p.suggested, ...p.others].map((e) => e.event_key));
  // Events already attached (e.g. when editing) that are no longer in the calendar window.
  const orphans: Row[] = [...p.selected.values()]
    .filter((s) => !candidateKeys.has(s.key))
    .map((s) => ({ key: s.key, series_key: s.series_key, title: s.title ?? 'Untitled event', time: timeLabel(s, p.timeZone), when: relationLabel(s), kind: s.kind, snapshot: s }));
  const main = [...p.suggested.map(toRow), ...orphans];
  const extra = p.others.map(toRow);

  if (main.length === 0 && extra.length === 0) return null;

  const chosen = [...main, ...extra].filter((r) => p.selected.has(r.key));
  const summary = chosen.length
    ? chosen
        .slice(0, 3)
        // All-day events and health items (whose titles already carry a duration) read better without a clock time.
        .map((r) => (r.event?.all_day || r.snapshot?.all_day || r.series_key.startsWith('health:') ? r.title : `${r.title} ${r.time}`))
        .join(' · ') + (chosen.length > 3 ? ` · +${chosen.length - 3}` : '')
    : 'None selected';

  const row = (r: Row) => {
    const checked = p.selected.has(r.key);
    const hidden = Boolean(p.ctx.series.get(r.series_key)?.hidden);
    return (
      <li key={r.key} className="event-row">
        <label className="event-check">
          <input type="checkbox" checked={checked} onChange={(e) => p.onToggle((r.event ?? r.snapshot)!, e.target.checked)} />
          <span className="event-text">
            <span className="event-title">{r.title}</span>
            <span className="event-meta">
              {r.time} · {r.when}
            </span>
          </span>
        </label>
        <button
          type="button"
          className={r.kind ? 'event-kind set' : 'event-kind'}
          aria-expanded={kindFor === r.key}
          aria-label={`Kind for ${r.title}: ${r.kind ?? 'not set'}`}
          onClick={() => setKindFor(kindFor === r.key ? null : r.key)}
        >
          {r.kind ?? 'Kind'}
        </button>
        {kindFor === r.key && (
          <KindChooser
            kinds={p.kinds}
            value={r.kind}
            onChange={(k) => {
              p.onSetKind(r.series_key, k);
              setKindFor(null);
            }}
            onAdd={p.onAddKind}
            hidden={hidden}
            onSetHidden={(h) => p.onSetHidden(r.series_key, h)}
          />
        )}
      </li>
    );
  };

  return (
    <section className="events section" aria-label="Calendar">
      <button type="button" className="events-summary" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span className="section-title">Around now</span>
        <span className="events-line">
          {summary}
          <span className="faint"> · {open ? 'done' : 'change'}</span>
        </span>
      </button>
      {open && (
        <div className="events-list">
          {main.length > 0 && <ul>{main.map(row)}</ul>}
          {extra.length > 0 && (
            <>
              <h3 className="section-title events-sub">Also today</h3>
              <ul>{extra.map(row)}</ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function KindChooser({
  kinds,
  value,
  onChange,
  onAdd,
  hidden,
  onSetHidden,
}: {
  kinds: string[];
  value: string | null;
  onChange: (k: string | null) => void;
  onAdd: (label: string) => void;
  hidden: boolean;
  onSetHidden: (h: boolean) => void;
}) {
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
    <div className="kind-chooser">
      <p className="faint small">Applies to this event and its repeats.</p>
      <div className="chip-list" role="radiogroup" aria-label="Kind">
        {kinds.map((k) => (
          <button key={k} type="button" role="radio" className="chip" aria-checked={value === k} aria-pressed={value === k} onClick={() => onChange(value === k ? null : k)}>
            {k}
          </button>
        ))}
        {adding ? (
          <form
            className="chip-add"
            onSubmit={(e) => {
              e.preventDefault();
              add();
            }}
          >
            <input autoFocus aria-label="New kind" value={text} maxLength={60} enterKeyHint="done" onChange={(e) => setText(e.target.value)} onBlur={add} />
          </form>
        ) : (
          <button type="button" className="chip chip-new" onClick={() => setAdding(true)}>+ Other</button>
        )}
      </div>
      <label className="small muted hide-toggle">
        <input type="checkbox" checked={hidden} onChange={(e) => onSetHidden(e.target.checked)} /> Don’t tick this automatically
      </label>
    </div>
  );
}
