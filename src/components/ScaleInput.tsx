import { useId } from 'react';
import type { Measure } from '../lib/vocabulary';
import type { Score } from '../data/types';

/**
 * A 1–5 scale as a radio group with large targets. The mark in each segment
 * grows with intensity ("more of the named thing"). Tapping the selected
 * value again clears it, since every measure is optional.
 */
export function ScaleInput({ measure, value, onChange }: { measure: Measure; value: Score | null; onChange: (v: Score | null) => void }) {
  const id = useId();
  return (
    <div className="scale" role="radiogroup" aria-labelledby={`${id}-label`}>
      <div className="scale-head">
        <span id={`${id}-label`} className="scale-label">{measure.label}</span>
        <span className="scale-value" aria-hidden="true">{value ? measure.levels[value - 1] : ''}</span>
      </div>
      <div className="scale-options">
        {measure.levels.map((word, i) => {
          const v = (i + 1) as Score;
          const checked = value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={word}
              className="scale-option"
              onClick={() => onChange(checked ? null : v)}
            >
              <span className="scale-mark" style={{ ['--size' as string]: `${6 + i * 3}px` }} />
            </button>
          );
        })}
      </div>
      <div className="scale-ends" aria-hidden="true">
        <span>{measure.levels[0]}</span>
        <span>{measure.levels[4]}</span>
      </div>
    </div>
  );
}
