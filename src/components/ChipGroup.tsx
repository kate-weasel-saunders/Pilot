import { useState, type FormEvent } from 'react';
import { cleanLabel, hasLabel } from '../lib/vocabulary';

/** Multi-select chips, with an inline way to add a new label. */
export function ChipGroup({
  title,
  options,
  selected,
  onChange,
  onAddCustom,
}: {
  title: string;
  options: string[];
  selected: string[];
  onChange: (next: string[]) => void;
  onAddCustom?: (label: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState('');

  const toggle = (label: string) =>
    onChange(hasLabel(selected, label) ? selected.filter((s) => s.toLocaleLowerCase() !== label.toLocaleLowerCase()) : [...selected, label]);

  const add = (e: FormEvent) => {
    e.preventDefault();
    const label = cleanLabel(text);
    if (label) {
      if (!hasLabel(options, label)) onAddCustom?.(label);
      if (!hasLabel(selected, label)) onChange([...selected, label]);
    }
    setText('');
    setAdding(false);
  };

  return (
    <fieldset className="chips">
      <legend className="section-title">{title}</legend>
      <div className="chip-list">
        {options.map((o) => (
          <button key={o} type="button" className="chip" aria-pressed={hasLabel(selected, o)} onClick={() => toggle(o)}>
            {o}
          </button>
        ))}
        {adding ? (
          <form onSubmit={add} className="chip-add">
            <input
              autoFocus
              aria-label={`Add to ${title}`}
              value={text}
              maxLength={60}
              enterKeyHint="done"
              onChange={(e) => setText(e.target.value)}
              onBlur={add}
            />
          </form>
        ) : (
          <button type="button" className="chip chip-new" onClick={() => setAdding(true)}>
            + Other
          </button>
        )}
      </div>
    </fieldset>
  );
}
