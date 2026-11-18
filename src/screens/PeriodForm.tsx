import { useState, type FormEvent } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useNavigate, useParams } from 'react-router';
import { db } from '../data/db';
import { removePeriod, savePeriod } from '../data/actions';
import { newId } from '../data/repo';
import type { Period } from '../data/types';
import { todayLocal } from '../lib/time';
import { PERIOD_CATEGORIES } from '../lib/vocabulary';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function PeriodForm() {
  const { id } = useParams();
  const existing = useLiveQuery(async () => (id ? ((await db.periods.get(id)) ?? null) : null), [id], undefined);
  if (id && existing === undefined) return null;
  if (id && existing === null)
    return (
      <main className="page">
        <p className="empty">This period no longer exists.</p>
        <Link to="/periods" className="button">Back to periods</Link>
      </main>
    );
  return <Editor key={id ?? 'new'} existing={existing ?? null} />;
}

function Editor({ existing }: { existing: Period | null }) {
  const navigate = useNavigate();
  const [title, setTitle] = useState(existing?.title ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [description, setDescription] = useState(existing?.description ?? '');
  const [startDate, setStartDate] = useState(existing?.start_date ?? todayLocal());
  const [startTime, setStartTime] = useState(existing?.start_time?.slice(0, 5) ?? '');
  const [endDate, setEndDate] = useState(existing?.end_date ?? '');
  const [endTime, setEndTime] = useState(existing?.end_time?.slice(0, 5) ?? '');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    if (!t) return setError('Give the period a name.');
    if (!startDate) return setError('Choose a start date.');
    if (endDate && endDate < startDate) return setError('The end date is before the start date.');
    if (endDate && endDate === startDate && startTime && endTime && endTime < startTime) return setError('The end time is before the start time.');
    await savePeriod({
      id: existing?.id ?? newId(),
      title: t.slice(0, 200),
      category: category || null,
      description: description.trim() || null,
      start_date: startDate,
      start_time: startTime || null,
      end_date: endDate || null,
      end_time: endDate && endTime ? endTime : null,
      extra: existing?.extra ?? {},
      created_at: existing?.created_at ?? new Date().toISOString(),
      updated_at: '',
    });
    navigate('/periods', { replace: true });
  };

  return (
    <main className="page">
      <div className="page-head">
        <h1>{existing ? 'Edit period' : 'New period'}</h1>
        <span className="spacer" />
        <button type="button" className="button quiet" onClick={() => navigate(-1)}>Cancel</button>
      </div>
      <form className="stack" onSubmit={submit} noValidate>
        <label className="field">
          <span>Name</span>
          <input value={title} maxLength={200} placeholder="e.g. Holiday" onChange={(e) => setTitle(e.target.value)} />
        </label>

        <fieldset className="chips">
          <legend className="section-title">Kind (optional)</legend>
          <div className="chip-list">
            {PERIOD_CATEGORIES.map((c) => (
              <button key={c} type="button" className="chip" aria-pressed={category === c} onClick={() => setCategory(category === c ? '' : c)}>
                {c}
              </button>
            ))}
          </div>
        </fieldset>

        <label className="field">
          <span>Notes (optional)</span>
          <textarea rows={3} value={description} maxLength={5000} placeholder="No work. Travelling and resting." onChange={(e) => setDescription(e.target.value)} />
        </label>

        <div className="field-row">
          <label className="field">
            <span>Starts</span>
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Time (optional)</span>
            <input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} />
          </label>
        </div>
        <div className="field-row">
          <label className="field">
            <span>Ends (leave empty if ongoing)</span>
            <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label className="field">
            <span>Time (optional)</span>
            <input type="time" value={endTime} disabled={!endDate} onChange={(e) => setEndTime(e.target.value)} />
          </label>
        </div>
        <p className="faint small">Dates include the whole day unless you set a time. Periods can overlap.</p>

        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary">Save period</button>
        {existing && (
          <button type="button" className="button quiet danger" onClick={() => setConfirming(true)}>Delete period</button>
        )}
      </form>

      <ConfirmDialog
        open={confirming}
        title="Delete this period?"
        body="The period is removed. Your check-ins from that time are kept."
        confirmLabel="Delete"
        onCancel={() => setConfirming(false)}
        onConfirm={async () => {
          if (existing) await removePeriod(existing.id);
          navigate('/periods', { replace: true });
        }}
      />
    </main>
  );
}
