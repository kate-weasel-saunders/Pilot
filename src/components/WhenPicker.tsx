import { deviceTimeZone, formatDayHeading, wallClock } from '../lib/time';

export type WhenPreset = 'now' | '30' | '60' | '120' | 'custom';

const PRESETS: { id: Exclude<WhenPreset, 'custom'>; label: string; minutes: number }[] = [
  { id: 'now', label: 'Now', minutes: 0 },
  { id: '30', label: '30 min ago', minutes: 30 },
  { id: '60', label: '1 hour ago', minutes: 60 },
  { id: '120', label: '2 hours ago', minutes: 120 },
];

/** The change a quick choice makes, relative to the moment it's tapped. */
function presetPatch(id: Exclude<WhenPreset, 'custom'>, minutes: number, timeZone: string): Partial<WhenValue> & { startedAt?: number } {
  const now = Date.now();
  const { date, time } = wallClock(new Date(now - minutes * 60000), timeZone);
  return id === 'now'
    ? { date, time: time.slice(0, 5), timeEdited: false, preset: 'now', startedAt: now }
    : { date, time: time.slice(0, 5), timeEdited: true, preset: id };
}

export interface WhenValue {
  date: string; // YYYY-MM-DD in timezone
  time: string; // HH:MM
  timezone: string;
  timeEdited: boolean;
  preset: WhenPreset;
}

/**
 * When the check-in is about. New check-ins get quick choices (now, or a bit
 * earlier) plus "Other time…"; edits show the date and time directly.
 */
export function WhenPicker({
  value,
  isNew,
  isFuture,
  onChange,
}: {
  value: WhenValue;
  isNew: boolean;
  isFuture: boolean;
  onChange: (patch: Partial<WhenValue> & { startedAt?: number }) => void;
}) {
  const today = wallClock(new Date(), value.timezone).date;
  const resolved = `${value.date === today ? 'Today' : formatDayHeading(value.date, today)} at ${value.time}${
    value.timezone !== deviceTimeZone() ? ` (${value.timezone})` : ''
  }`;

  const pick = (id: Exclude<WhenPreset, 'custom'>, minutes: number) => onChange(presetPatch(id, minutes, value.timezone));

  const showFields = !isNew || value.preset === 'custom';

  return (
    <section className="when-picker" aria-label="When">
      <div className="row">
        <h2 className="section-title">When</h2>
        <span className="when-summary">{resolved}</span>
      </div>
      {isNew && (
        <div className="chip-list" role="radiogroup" aria-label="When">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" className="chip" aria-checked={value.preset === p.id} aria-pressed={value.preset === p.id} onClick={() => pick(p.id, p.minutes)}>
              {p.label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            className="chip"
            aria-checked={value.preset === 'custom'}
            aria-pressed={value.preset === 'custom'}
            onClick={() => onChange({ preset: 'custom', timeEdited: true })}
          >
            Other time…
          </button>
        </div>
      )}
      {showFields && (
        <div className="field-row">
          <label className="field">
            <span>Date</span>
            <input type="date" value={value.date} max={today} required onChange={(e) => e.target.value && onChange({ date: e.target.value, timeEdited: true, preset: 'custom' })} />
          </label>
          <label className="field">
            <span>Time</span>
            <input type="time" value={value.time} required onChange={(e) => e.target.value && onChange({ time: e.target.value, timeEdited: true, preset: 'custom' })} />
          </label>
        </div>
      )}
      {isFuture && (
        <p className="error" role="alert">
          That time is in the future. Choose now or an earlier time.
        </p>
      )}
    </section>
  );
}
