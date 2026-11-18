import { useEffect, useRef, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate, useParams } from 'react-router';
import { db, getMeta, setMeta } from '../data/db';
import { removeCheckIn, saveCheckIn, saveTag } from '../data/actions';
import { newId } from '../data/repo';
import type { CheckIn, Score, Tag, TagKind } from '../data/types';
import { deviceTimeZone, formatDayHeading, instantFromWallClock, localFields, wallClock } from '../lib/time';
import { chipsFor, MEASURES, TAG_GROUPS } from '../lib/vocabulary';
import { ScaleInput } from '../components/ScaleInput';
import { ChipGroup } from '../components/ChipGroup';
import { ConfirmDialog } from '../components/ConfirmDialog';

const DRAFT_KEY = 'draft:new-check-in';
const DRAFT_MAX_AGE_MS = 6 * 60 * 60 * 1000;

type Fields = Pick<CheckIn, 'mood' | 'energy' | 'anxiety' | 'pressure' | 'body_tags' | 'context_tags' | 'need_tags'> & {
  thought: string;
  preceding: string;
};

interface Draft {
  fields: Fields;
  /** Wall-clock moment the check-in is about, in `timezone`. */
  date: string;
  time: string; // HH:MM
  timezone: string;
  timeEdited: boolean;
  startedAt: number;
}

const emptyFields = (): Fields => ({
  mood: null, energy: null, anxiety: null, pressure: null,
  body_tags: [], context_tags: [], need_tags: [], thought: '', preceding: '',
});

function newDraft(): Draft {
  const tz = deviceTimeZone();
  const { date, time } = wallClock(new Date(), tz);
  return { fields: emptyFields(), date, time: time.slice(0, 5), timezone: tz, timeEdited: false, startedAt: Date.now() };
}

function draftFrom(c: CheckIn): Draft {
  return {
    fields: {
      mood: c.mood, energy: c.energy, anxiety: c.anxiety, pressure: c.pressure,
      body_tags: c.body_tags, context_tags: c.context_tags, need_tags: c.need_tags,
      thought: c.thought ?? '', preceding: c.preceding ?? '',
    },
    date: c.local_date,
    time: c.local_time.slice(0, 5),
    timezone: c.timezone,
    timeEdited: false,
    startedAt: Date.now(),
  };
}

const hasContent = (f: Fields) =>
  [f.mood, f.energy, f.anxiety, f.pressure].some((v) => v != null) ||
  f.body_tags.length + f.context_tags.length + f.need_tags.length > 0 ||
  f.thought.trim() !== '' ||
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
        const fresh = saved && Date.now() - saved.startedAt < DRAFT_MAX_AGE_MS ? saved : newDraft();
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
  const f = draft.fields;
  const isNew = existing === null;

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
    if (!hasContent(f) || saving) return;
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
      extra: existing?.extra ?? {},
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

  const today = wallClock(new Date(), draft.timezone).date;

  return (
    <main className="page checkin-form">
      <div className="page-head">
        <h1>{isNew ? 'Check in' : 'Edit check-in'}</h1>
        <span className="spacer" />
        <button type="button" className="button quiet" onClick={cancel}>
          {isNew ? 'Discard' : 'Cancel'}
        </button>
      </div>

      <details className="more when" open={draft.timeEdited}>
        <summary>
          {draft.date === today ? 'Today' : formatDayHeading(draft.date, today)} at {draft.time}
          {draft.timezone !== deviceTimeZone() && ` (${draft.timezone})`}
          <span className="faint">&nbsp;· change</span>
        </summary>
        <div className="field-row">
          <label className="field">
            <span>Date</span>
            <input type="date" value={draft.date} max={today} required onChange={(e) => e.target.value && setDraft((d) => ({ ...d, date: e.target.value, timeEdited: true }))} />
          </label>
          <label className="field">
            <span>Time</span>
            <input type="time" value={draft.time} required onChange={(e) => e.target.value && setDraft((d) => ({ ...d, time: e.target.value, timeEdited: true }))} />
          </label>
        </div>
      </details>

      <div>
        {MEASURES.map((m) => (
          <ScaleInput key={m.key} measure={m} value={f[m.key]} onChange={(v: Score | null) => setField(m.key, v)} />
        ))}
      </div>

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
          <button type="button" className="button primary" disabled={!hasContent(f) || saving} onClick={save}>
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
