import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router';
import { db, getMeta, setMeta } from '../data/db';
import { removeCheckIn, saveCheckIn, saveSeriesPref, saveTag } from '../data/actions';
import { useCalendar } from '../data/hooks';
import { candidatesFor, snapshotOf } from '../lib/calendar';
import { EventPicker } from '../components/EventPicker';
import { WhenPicker, type WhenPreset } from '../components/WhenPicker';
import { newId } from '../data/repo';
import type { CalendarEvent, CheckIn, EventSnapshot, Score, Tag, TagKind } from '../data/types';
import { deviceTimeZone, instantFromWallClock, localFields, wallClock } from '../lib/time';
import { chipsFor, MEASURES, TAG_GROUPS } from '../lib/vocabulary';
import { pressureReason, withPressureReason } from '../lib/extra';
import { ScaleInput } from '../components/ScaleInput';
import { ChipGroup } from '../components/ChipGroup';
import { ConfirmDialog } from '../components/ConfirmDialog';

const DRAFT_KEY = 'draft:new-check-in';
const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type Fields = Pick<CheckIn, 'mood' | 'energy' | 'anxiety' | 'pressure' | 'body_tags' | 'context_tags' | 'need_tags'> & {
  thought: string;
  preceding: string;
  pressureReason: string;
};

interface Draft {
  fields: Fields;
  /** Wall-clock moment the check-in is about, in `timezone`. */
  date: string;
  time: string; // HH:MM
  timezone: string;
  timeEdited: boolean;
  startedAt: number;
  /** Which "When" choice is selected (new check-ins). */
  preset?: WhenPreset;
  /** Chosen calendar events; null = use the default rule at save time. */
  events: EventSnapshot[] | null;
}

const emptyFields = (): Fields => ({
  mood: null, energy: null, anxiety: null, pressure: null,
  body_tags: [], context_tags: [], need_tags: [], thought: '', preceding: '', pressureReason: '',
});

function newDraft(): Draft {
  const tz = deviceTimeZone();
  const { date, time } = wallClock(new Date(), tz);
  return { fields: emptyFields(), date, time: time.slice(0, 5), timezone: tz, timeEdited: false, startedAt: Date.now(), events: null };
}

function draftFrom(c: CheckIn): Draft {
  return {
    fields: {
      mood: c.mood, energy: c.energy, anxiety: c.anxiety, pressure: c.pressure,
      body_tags: c.body_tags, context_tags: c.context_tags, need_tags: c.need_tags,
      thought: c.thought ?? '', preceding: c.preceding ?? '', pressureReason: pressureReason(c) ?? '',
    },
    date: c.local_date,
    time: c.local_time.slice(0, 5),
    timezone: c.timezone,
    timeEdited: false,
    startedAt: Date.now(),
    events: c.events ?? [],
  };
}

const hasContent = (f: Fields) =>
  [f.mood, f.energy, f.anxiety, f.pressure].some((v) => v != null) ||
  f.body_tags.length + f.context_tags.length + f.need_tags.length > 0 ||
  f.thought.trim() !== '' ||
  (f.pressureReason ?? '').trim() !== '' ||
  f.preceding.trim() !== '';

/** Loads the starting state (existing entry or saved draft), then renders the form. */
export function CheckInForm() {
  const { id } = useParams();
  const [initial, setInitial] = useState<{ draft: Draft; existing: CheckIn | null } | 'missing' | null>(null);

  useEffect(() => {
    let live = true;
    (async () => {
      if (id) {
        const c = await db.check_ins.get(id);
        if (live) setInitial(c ? { draft: draftFrom(c), existing: c } : 'missing');
      } else {
        const saved = await getMeta<Draft>(db, DRAFT_KEY);
        const fresh = saved && Date.now() - saved.startedAt < DRAFT_MAX_AGE_MS ? { ...saved, events: saved.events ?? null } : newDraft();
        if (live) setInitial({ draft: fresh, existing: null });
      }
    })();
    return () => {
      live = false;
    };
  }, [id]);

  if (initial === null) return null;
  if (initial === 'missing')
    return (
      <main className="page">
        <p className="empty">This check-in no longer exists.</p>
      </main>
    );
  return <Form key={id ?? 'new'} initial={initial.draft} existing={initial.existing} />;
}

function Form({ initial, existing }: { initial: Draft; existing: CheckIn | null }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const tags = useLiveQuery(() => db.tags.toArray(), [], [] as Tag[]);
  const calendar = useCalendar();
  // Current time, refreshed every 30 s (for the "not in the future" check).
  const [clock, setClock] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);
  const f = draft.fields;
  const isNew = existing === null;

  // The moment this check-in is about, which drives which events are relevant.
  const at = !isNew && !draft.timeEdited && existing
    ? new Date(existing.observed_at)
    : draft.timeEdited
      ? instantFromWallClock(draft.date, draft.time, draft.timezone)
      : new Date(draft.startedAt);
  const atDate = wallClock(at, draft.timezone).date;
  // A minute's grace so "now" picked just before saving never counts as future.
  const isFuture = at.getTime() > clock + 60_000;
  const candidates = candidatesFor(calendar.events, at, atDate, draft.timezone, calendar.ctx);
  const eventsByKey = new Map(calendar.events.map((e) => [e.event_key, e]));
  const selected = new Map(
    (draft.events ?? candidates.suggested.map((e) => snapshotOf(e, at, atDate, calendar.ctx))).map((s) => [s.key, s]),
  );

  const toggleEvent = (item: CalendarEvent | EventSnapshot, on: boolean) => {
    const next = new Map(selected);
    const key = 'event_key' in item ? item.event_key : item.key;
    if (on) next.set(key, 'event_key' in item ? snapshotOf(item, at, atDate, calendar.ctx) : item);
    else next.delete(key);
    setDraft((d) => ({ ...d, events: [...next.values()] }));
  };

  /** Final snapshots: refreshed from the calendar where the event still exists. */
  const finalEvents = (instant: Date, localDate: string): EventSnapshot[] => {
    if (draft.events === null) {
      const c = candidatesFor(calendar.events, instant, localDate, draft.timezone, calendar.ctx);
      return c.suggested.map((e) => snapshotOf(e, instant, localDate, calendar.ctx));
    }
    return draft.events.map((s) => {
      const e = eventsByKey.get(s.key);
      return e ? snapshotOf(e, instant, localDate, calendar.ctx) : s;
    });
  };

  // Persist an unsaved new check-in so it survives the app being closed.
  const firstRender = useRef(true);
  useEffect(() => {
    if (!isNew) return;
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      if (hasContent(draft.fields)) void setMeta(db, DRAFT_KEY, draft);
    }, 400);
    return () => clearTimeout(t);
  }, [draft, isNew]);

  const setField = <K extends keyof Fields>(k: K, v: Fields[K]) => setDraft((d) => ({ ...d, fields: { ...d.fields, [k]: v } }));

  const addCustom = (kind: TagKind, label: string) =>
    void saveTag({
      id: newId(), kind, label, hidden: false,
      sort_order: tags.filter((t) => t.kind === kind).length,
      created_at: new Date().toISOString(), updated_at: '',
    });

  const save = async () => {
    if (!hasContent(f) || saving || isFuture) return;
    setSaving(true);
    const instant = draft.timeEdited || !isNew ? instantFromWallClock(draft.date, draft.time, draft.timezone) : new Date(draft.startedAt);
    // Keep seconds from the original entry if the time wasn't touched.
    const local = !isNew && !draft.timeEdited && existing
      ? { observed_at: existing.observed_at, timezone: existing.timezone, local_date: existing.local_date, local_time: existing.local_time }
      : localFields(instant, draft.timezone);
    const record: CheckIn = {
      id: existing?.id ?? newId(),
      ...local,
      mood: f.mood, energy: f.energy, anxiety: f.anxiety, pressure: f.pressure,
      body_tags: f.body_tags, context_tags: f.context_tags, need_tags: f.need_tags,
      thought: f.thought.trim() || null,
      preceding: f.preceding.trim() || null,
      events: finalEvents(new Date(local.observed_at), local.local_date),
      extra: withPressureReason(existing?.extra ?? {}, f.pressureReason ?? ''),
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: '',
    };
    await saveCheckIn(record);
    if (isNew) {
      await db.meta.delete(DRAFT_KEY);
      navigate('/', { replace: true, state: { saved: true } });
    } else {
      navigate(-1);
    }
  };

  const cancel = async () => {
    if (isNew) await db.meta.delete(DRAFT_KEY);
    navigate(-1);
  };


  return (
    <main className="page checkin-form">
      <div className="page-head">
        <h1>{isNew ? 'Check in' : 'Edit check-in'}</h1>
        <span className="spacer" />
        <button type="button" className="button quiet" onClick={cancel}>
          {isNew ? 'Discard' : 'Cancel'}
        </button>
      </div>

      <WhenPicker
        value={{ date: draft.date, time: draft.time, timezone: draft.timezone, timeEdited: draft.timeEdited, preset: draft.preset ?? (draft.timeEdited ? 'custom' : 'now') }}
        isNew={isNew}
        isFuture={isFuture}
        onChange={(patch) => setDraft((d) => ({ ...d, ...patch }))}
      />

      <div>
        {MEASURES.map((m) => (
          <div key={m.key}>
            <ScaleInput measure={m} value={f[m.key]} onChange={(v: Score | null) => setField(m.key, v)} />
            {/* Optional reason, offered once there's some pressure (or if one was already written). */}
            {m.key === 'pressure' && ((f.pressure ?? 0) > 1 || (f.pressureReason ?? '') !== '') && (
              <label className="field scale-reason">
                <span className="visually-hidden">What’s the pressure coming from? (optional)</span>
                <input
                  value={f.pressureReason ?? ''}
                  maxLength={500}
                  placeholder="What’s it coming from? (optional)"
                  enterKeyHint="done"
                  onChange={(e) => setField('pressureReason', e.target.value)}
                />
              </label>
            )}
          </div>
        ))}
      </div>

      <EventPicker
        suggested={candidates.suggested}
        others={candidates.others}
        selected={selected}
        ctx={calendar.ctx}
        at={at}
        localDate={atDate}
        timeZone={draft.timezone}
        kinds={chipsFor('event', tags)}
        onToggle={toggleEvent}
        onSetKind={(seriesKey, kind) => void saveSeriesPref(seriesKey, { kind })}
        onAddKind={(label) => addCustom('event', label)}
        onSetHidden={(seriesKey, hidden) => void saveSeriesPref(seriesKey, { hidden })}
      />

      <label className="field thought-field section">
        <span className="section-title">What’s going through your head?</span>
        <textarea value={f.thought} rows={4} maxLength={20000} onChange={(e) => setField('thought', e.target.value)} />
      </label>

      {TAG_GROUPS.map((g) => (
        <div className="section" key={g.kind}>
          <ChipGroup
            title={g.title}
            options={chipsFor(g.kind, tags, f[g.column])}
            selected={f[g.column]}
            onChange={(next) => setField(g.column, next)}
            onAddCustom={(label) => addCustom(g.kind, label)}
          />
        </div>
      ))}

      <details className="more section" open={f.preceding !== ''}>
        <summary>What happened just before this?</summary>
        <label className="field thought-field">
          <span className="visually-hidden">What happened just before this?</span>
          <textarea value={f.preceding} rows={3} maxLength={5000} onChange={(e) => setField('preceding', e.target.value)} />
        </label>
      </details>

      {!isNew && (
        <div className="section">
          <button type="button" className="button quiet danger" onClick={() => setConfirmDelete(true)}>
            Delete this check-in
          </button>
        </div>
      )}

      <div className="save-bar">
        <div className="inner">
          <button type="button" className="button primary" disabled={!hasContent(f) || saving || isFuture} onClick={save}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this check-in?"
        body="It will be permanently removed from this device and from your account. This can’t be undone."
        confirmLabel="Delete"
        onCancel={() => setConfirmDelete(false)}
        onConfirm={async () => {
          if (existing) await removeCheckIn(existing.id);
          navigate(-1);
        }}
      />
    </main>
  );
}
