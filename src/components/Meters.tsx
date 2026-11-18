import type { CheckIn } from '../data/types';
import { levelLabel, MEASURES } from '../lib/vocabulary';

const SHORT: Record<string, string> = { mood: 'Mood', energy: 'Energy', anxiety: 'Anxiety', pressure: 'Pressure' };

/** The four measures at a glance: a label and five small pips each. */
export function Meters({ c }: { c: CheckIn }) {
  return (
    <div className="meters">
      {MEASURES.map((m) => {
        const v = c[m.key];
        const word = levelLabel(m.key, v);
        return (
          <div key={m.key} className="meter" title={word ?? 'Not recorded'}>
            <span className="meter-label">{SHORT[m.key]}</span>
            <span className="meter-pips" role="img" aria-label={`${m.label}: ${word ?? 'not recorded'}`}>
              {[1, 2, 3, 4, 5].map((i) => (
                <span key={i} className={v != null && i <= v ? 'pip on' : 'pip'} />
              ))}
            </span>
          </div>
        );
      })}
    </div>
  );
}
