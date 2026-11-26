import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';

/** A touch that moves further than this (px) is a scroll, not a tap. */
const TAP_SLOP = 8;
import type { Band, Point } from '../lib/trends';
import { isWeekend } from '../lib/time';

/**
 * One small-multiple trend chart (SVG). Single series, one y-axis.
 * - line: daily values (2px), broken across gaps
 * - dots: individual readings (8px, 2px surface ring)
 * - bars: one per day, anchored to the baseline (sleep)
 * - bands: periods as soft shaded spans
 * A tap (not a scroll or a long press) or the arrow keys select a day; tapping
 * the selected day again clears it. the selection is shared across charts by
 * the parent, which shows the values (tooltips enhance, never gate: there's a
 * table view too).
 */

export interface TrendChartProps {
  title: string;
  days: string[];
  yMin: number;
  yMax: number;
  /** Labels drawn at gridlines, e.g. [{ value: 5, label: 'Very good' }]. */
  yTicks: { value: number; label: string }[];
  color: string; // CSS colour (var())
  line?: Point[][];
  dots?: Point[];
  bars?: Point[];
  bands: Band[];
  showBandLabels?: boolean;
  selected: string | null;
  onSelect: (date: string | null) => void;
  height?: number;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => entry && setWidth(Math.max(200, Math.round(entry.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

const dayOf = (d: string) => new Date(`${d}T12:00:00Z`);
const weekdayLetter = (d: string) => dayOf(d).toLocaleDateString(undefined, { weekday: 'narrow', timeZone: 'UTC' });
/** Weekday letters only while each day has room for one. */
const MAX_LETTER_DAYS = 31;

const shortDate = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' });

export function TrendChart(p: TrendChartProps) {
  const [ref, width] = useWidth<HTMLDivElement>();
  const plotH = p.height ?? 112;
  const letters = p.days.length <= MAX_LETTER_DAYS;
  const axisH = letters ? 36 : 22;
  const padTop = p.showBandLabels && p.bands.length ? 18 : 6;
  const padX = 8;
  const n = p.days.length;
  const step = n > 1 ? (width - padX * 2) / (n - 1) : 0;
  const index = new Map(p.days.map((d, i) => [d, i]));
  const x = (d: string) => padX + (index.get(d) ?? 0) * step;
  const y = (v: number) => padTop + (1 - (v - p.yMin) / (p.yMax - p.yMin || 1)) * plotH;
  const totalH = padTop + plotH + axisH;
  const barW = Math.max(2, Math.min(14, step - 2));

  const tap = useRef<{ id: number; x: number; y: number; t: number } | null>(null);
  const pick = (clientX: number, svg: SVGSVGElement) => {
    const rect = svg.getBoundingClientRect();
    const px = ((clientX - rect.left) / rect.width) * width;
    const i = Math.max(0, Math.min(n - 1, Math.round((px - padX) / (step || 1))));
    const d = p.days[i] ?? null;
    p.onSelect(d === p.selected ? null : d);
  };
  const down = (e: PointerEvent<SVGSVGElement>) => {
    tap.current = { id: e.pointerId, x: e.clientX, y: e.clientY, t: e.timeStamp };
  };
  const move = (e: PointerEvent<SVGSVGElement>) => {
    const t = tap.current;
    if (t && t.id === e.pointerId && Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP) tap.current = null;
  };
  const up = (e: PointerEvent<SVGSVGElement>) => {
    const t = tap.current;
    tap.current = null;
    if (!t || t.id !== e.pointerId || e.timeStamp - t.t > 500) return;
    if (Math.hypot(e.clientX - t.x, e.clientY - t.y) > TAP_SLOP) return;
    pick(e.clientX, e.currentTarget);
  };
  const key = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Escape') return;
    e.preventDefault();
    if (e.key === 'Escape') return p.onSelect(null);
    const cur = p.selected ? (index.get(p.selected) ?? n - 1) : n - 1;
    const next = Math.max(0, Math.min(n - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1)));
    p.onSelect(p.days[next] ?? null);
  };

  const xTicks = n <= 1 ? p.days : [p.days[0]!, p.days[Math.floor((n - 1) / 2)]!, p.days[n - 1]!];
  const sel = p.selected && index.has(p.selected) ? p.selected : null;
  const selValue = sel ? (p.line?.flat().find((q) => q.date === sel) ?? p.bars?.find((q) => q.date === sel)) : undefined;

  return (
    <div className="trend-chart" ref={ref}>
      <div className="trend-title">{p.title}</div>
      <svg
        width={width}
        height={totalH}
        viewBox={`0 0 ${width} ${totalH}`}
        role="group"
        aria-label={`${p.title} chart. Tap a day, or use the arrow keys, to see its values. The table view lists every value.`}
        tabIndex={0}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={() => (tap.current = null)}
        onKeyDown={key}
        style={{ touchAction: 'pan-y' }}
      >
        {/* period bands */}
        {p.bands.map((b) => {
          const x0 = x(b.from) - step / 2;
          const x1 = x(b.to) + step / 2;
          return (
            <g key={b.id}>
              <rect x={Math.max(0, x0)} y={padTop} width={Math.max(2, Math.min(width, x1) - Math.max(0, x0))} height={plotH} fill="var(--chart-band)" rx={4} />
              {p.showBandLabels && (
                <text x={Math.max(2, x0 + 2)} y={12} className="trend-band-label">
                  {b.title}
                </text>
              )}
            </g>
          );
        })}

        {/* gridlines + y labels */}
        {p.yTicks.map((t) => (
          <g key={t.value}>
            <line x1={0} x2={width} y1={y(t.value)} y2={y(t.value)} className="trend-grid" />
            {/* The top label sits just below its line, others just above: always inside the plot. */}
            <text x={width - 2} y={t.value >= p.yMax ? y(t.value) + 12 : y(t.value) - 3} textAnchor="end" className="trend-axis">
              {t.label}
            </text>
          </g>
        ))}

        {/* bars (anchored to baseline, 2px gap, rounded data-end) */}
        {p.bars?.map((b) => {
          const top = y(b.value);
          const h = Math.max(1, y(p.yMin) - top);
          return <path key={b.date} d={roundedTopBar(x(b.date) - barW / 2, top, barW, h, Math.min(4, barW / 2))} fill={p.color} opacity={sel && sel !== b.date ? 0.45 : 1} />;
        })}

        {/* daily line */}
        {p.line?.map((seg, i) =>
          seg.length > 1 ? (
            <polyline key={i} points={seg.map((q) => `${x(q.date)},${y(q.value)}`).join(' ')} fill="none" stroke={p.color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          ) : (
            <circle key={i} cx={x(seg[0]!.date)} cy={y(seg[0]!.value)} r={3} fill={p.color} />
          ),
        )}

        {/* individual readings */}
        {p.dots?.map((d, i) => (
          <circle key={i} cx={x(d.date)} cy={y(d.value)} r={4} fill={p.color} fillOpacity={0.35} stroke="var(--surface)" strokeWidth={2} />
        ))}

        {/* selection crosshair */}
        {sel && (
          <g>
            <line x1={x(sel)} x2={x(sel)} y1={padTop} y2={padTop + plotH} className="trend-crosshair" />
            {selValue && <circle cx={x(sel)} cy={y(selValue.value)} r={5} fill={p.color} stroke="var(--surface)" strokeWidth={2} />}
          </g>
        )}

        {/* weekday letters (weekends picked out) */}
        {letters &&
          p.days.map((d) => (
            <text key={`w-${d}`} x={x(d)} y={padTop + plotH + 14} textAnchor="middle" className={isWeekend(d) ? 'trend-weekday weekend' : 'trend-weekday'} aria-hidden="true">
              {weekdayLetter(d)}
            </text>
          ))}

        {/* x axis */}
        {xTicks.map((d, i) => (
          <text key={`${d}-${i}`} x={x(d)} y={padTop + plotH + (letters ? 31 : 16)} textAnchor={i === 0 ? 'start' : i === xTicks.length - 1 ? 'end' : 'middle'} className="trend-axis">
            {shortDate(d)}
          </text>
        ))}
      </svg>
    </div>
  );
}

function roundedTopBar(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, h);
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`;
}
