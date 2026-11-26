import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { Link, useSearchParams } from 'react-router';
import { db } from '../data/db';
import { useCheckIns, usePeriods } from '../data/hooks';
import type { HealthSampleRow, MeasureKey } from '../data/types';
import { deviceTimeZone, formatDayHeading, todayLocal } from '../lib/time';
import { levelLabel, MEASURES, type Measure } from '../lib/vocabulary';
import { formatMinutes } from '../lib/health';
import { daysIn, healthSeries, measureSeries, periodBands, presetRange, segments, type Band, type HealthDaily, type MeasureSeries, type Range, type RangePreset } from '../lib/trends';
import { TrendChart } from '../components/TrendChart';

const PRESETS: { id: Exclude<RangePreset, 'custom'>; label: string }[] = [
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
  { id: '90', label: '90 days' },
];

const SHORT: Record<MeasureKey, string> = { mood: 'Mood', energy: 'Energy', anxiety: 'Anxiety / tension', pressure: 'Pressure / demand' };

export function Patterns() {
  const [params, setParams] = useSearchParams();
  const today = todayLocal();
  const preset = (params.get('range') as RangePreset | null) ?? '30';
  const range: Range =
    preset === 'custom'
      ? { from: params.get('from') || presetRange('30', today).from, to: params.get('to') || today }
      : presetRange(preset === '7' || preset === '90' ? preset : '30', today);
  const validRange = range.from <= range.to;

  const checkIns = useCheckIns();
  const periods = usePeriods();
  const health = useLiveQuery(() => db.health_samples.toArray(), [], [] as HealthSampleRow[]);
  const [selected, setSelected] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);

  const data = useMemo((): Data | null => {
    if (!validRange) return null;
    const days = daysIn(range);
    const measures = MEASURES.map((m) => ({ m, s: measureSeries(checkIns ?? [], m.key, range) }));
    const h = healthSeries(health, range, deviceTimeZone());
    return { days, measures, health: h, bands: periodBands(periods, range), any: measures.some((x) => x.s.points.length > 0) };
  }, [checkIns, periods, health, range.from, range.to, validRange]); // eslint-disable-line react-hooks/exhaustive-deps

  const setRange = (next: Record<string, string>) => {
    setSelected(null);
    setParams(next, { replace: true });
  };

  const sel = selected && data?.days.includes(selected) ? selected : null;
  const selInfo = sel && data ? dayInfo(sel, data) : null;

  return (
    <main className="page">
      <div className="page-head">
        <h1>Patterns</h1>
      </div>

      <div className="stack trend-filters">
        <div className="chip-list" role="radiogroup" aria-label="Time range">
          {PRESETS.map((p) => (
            <button key={p.id} type="button" role="radio" className="chip" aria-checked={preset === p.id} aria-pressed={preset === p.id} onClick={() => setRange({ range: p.id })}>
              {p.label}
            </button>
          ))}
          <button
            type="button"
            role="radio"
            className="chip"
            aria-checked={preset === 'custom'}
            aria-pressed={preset === 'custom'}
            onClick={() => setRange({ range: 'custom', from: range.from, to: range.to })}
          >
            Custom
          </button>
        </div>
        {preset === 'custom' && (
          <div className="field-row">
            <label className="field">
              <span>From</span>
              <input type="date" value={range.from} max={today} onChange={(e) => e.target.value && setRange({ range: 'custom', from: e.target.value, to: range.to })} />
            </label>
            <label className="field">
              <span>To</span>
              <input type="date" value={range.to} max={today} onChange={(e) => e.target.value && setRange({ range: 'custom', from: range.from, to: e.target.value })} />
            </label>
          </div>
        )}
        {!validRange && <p className="error" role="alert">The start date is after the end date.</p>}
      </div>

      {checkIns === undefined || !data ? null : !data.any ? (
        <p className="empty">Trends appear here once there are check-ins in this range.</p>
      ) : (
        <>
          <p className="faint small trend-note">
            Lines show each day’s average; faint dots are individual check-ins. Tap a day to see its values.
          </p>

          {selInfo && (
            <section className="trend-selection" aria-live="polite" aria-label="Selected day">
              <div className="trend-selection-head">
                <h2 className="trend-selection-date">{formatDayHeading(sel!, today)}</h2>
                <Link className="trend-selection-link" to={`/history?from=${sel}&to=${sel}`}>
                  History →
                </Link>
                <button type="button" className="button quiet small trend-selection-close" onClick={() => setSelected(null)} aria-label="Clear selection">
                  ✕
                </button>
              </div>
              <dl className="trend-values">
                {selInfo.map((v) => (
                  <div key={v.label}>
                    <dt>{v.label}</dt>
                    <dd>
                      {v.value}
                      {v.note && <span className="trend-value-note">{v.note}</span>}
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          )}

          <div className="trend-card">
            {data.measures.map(({ m, s }, i) => (
              <TrendChart
                key={m.key}
                title={SHORT[m.key]}
                days={data.days}
                yMin={1}
                yMax={5}
                yTicks={[
                  { value: 5, label: m.levels[4] },
                  { value: 3, label: '' },
                  { value: 1, label: m.levels[0] },
                ]}
                color="var(--chart-measure)"
                line={segments(s.daily)}
                dots={s.points}
                bands={data.bands}
                showBandLabels={i === 0}
                selected={sel}
                onSelect={setSelected}
              />
            ))}
            {data.health.sleepHours.length > 0 && (
              <TrendChart
                title="Sleep (hours)"
                days={data.days}
                yMin={0}
                yMax={Math.max(10, Math.ceil(Math.max(...data.health.sleepHours.map((q) => q.value))))}
                yTicks={[{ value: 8, label: '8h' }, { value: 4, label: '4h' }]}
                color="var(--chart-sleep)"
                bars={data.health.sleepHours}
                bands={data.bands}
                selected={sel}
                onSelect={setSelected}
                height={80}
              />
            )}
            {data.health.hrv.length > 0 && (
              <TrendChart
                title="HRV (ms, daily average)"
                days={data.days}
                yMin={0}
                yMax={Math.max(40, Math.ceil(Math.max(...data.health.hrv.map((q) => q.value)) / 20) * 20)}
                yTicks={hrvTicks(data.health.hrv)}
                color="var(--chart-hrv)"
                line={segments(data.health.hrv)}
                bands={data.bands}
                selected={sel}
                onSelect={setSelected}
                height={80}
              />
            )}
          </div>

          <div className="section">
            <button type="button" className="button wide" aria-expanded={showTable} onClick={() => setShowTable(!showTable)}>
              {showTable ? 'Hide table' : 'Show as table'}
            </button>
            {showTable && <TrendTable data={data} />}
          </div>
        </>
      )}
    </main>
  );
}

interface Data {
  days: string[];
  measures: { m: Measure; s: MeasureSeries }[];
  health: HealthDaily;
  bands: Band[];
  any: boolean;
}

function hrvTicks(hrv: { value: number }[]) {
  const max = Math.max(...hrv.map((q) => q.value));
  const top = Math.max(40, Math.ceil(max / 20) * 20);
  return [{ value: top, label: `${top}` }, { value: top / 2, label: `${top / 2}` }];
}

function dayInfo(date: string, data: Data): { label: string; value: string; note?: string }[] {
  const out: { label: string; value: string; note?: string }[] = [];
  for (const { m, s } of data.measures) {
    const d = s.daily.find((q) => q.date === date);
    out.push({
      label: SHORT[m.key].split(' /')[0]!,
      value: (d && levelLabel(m.key, Math.round(d.value))) || '—',
      ...(d && d.n > 1 ? { note: `avg of ${d.n}` } : {}),
    });
  }
  const sleep = data.health.sleepHours.find((q) => q.date === date);
  const hrv = data.health.hrv.find((q) => q.date === date);
  if (data.health.sleepHours.length) out.push({ label: 'Sleep', value: sleep ? formatMinutes(sleep.value * 60) : '—' });
  if (data.health.hrv.length) out.push({ label: 'HRV', value: hrv ? `${hrv.value} ms` : '—' });
  return out;
}

function TrendTable({ data }: { data: Data }) {
  const rows = [...data.days].reverse().filter((d) => data.measures.some(({ s }) => s.daily.some((q) => q.date === d)));
  const cell = (date: string, key: MeasureKey) => {
    const d = data.measures.find((x) => x.m.key === key)!.s.daily.find((q) => q.date === date);
    return d ? `${levelLabel(key, Math.round(d.value))}${d.n > 1 ? ` (${d.n})` : ''}` : '—';
  };
  return (
    <div className="trend-table-wrap">
      <table className="trend-table">
        <caption className="visually-hidden">Daily averages (number of check-ins in brackets)</caption>
        <thead>
          <tr>
            <th scope="col">Day</th>
            {MEASURES.map((m) => (
              <th key={m.key} scope="col">
                {SHORT[m.key].split(' /')[0]}
              </th>
            ))}
            {data.health.sleepHours.length > 0 && <th scope="col">Sleep</th>}
            {data.health.hrv.length > 0 && <th scope="col">HRV</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((d) => (
            <tr key={d}>
              <th scope="row">{new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' })}</th>
              {MEASURES.map((m) => (
                <td key={m.key}>{cell(d, m.key)}</td>
              ))}
              {data.health.sleepHours.length > 0 && <td>{fmtSleep(data, d)}</td>}
              {data.health.hrv.length > 0 && <td>{data.health.hrv.find((q) => q.date === d)?.value ?? '—'}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const fmtSleep = (data: Data, d: string) => {
  const s = data.health.sleepHours.find((q) => q.date === d);
  return s ? formatMinutes(s.value * 60) : '—';
};
