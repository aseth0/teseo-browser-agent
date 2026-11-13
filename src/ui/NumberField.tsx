// A number field shown as typed until it is left (or Enter is pressed), then as saved: a number within
// its range is saved as typed; one out of it, or the field emptied, only once it is left, clamped (and
// rounded), so "200" can be typed in a field of 50 to 3,000. Emptied: `onSave(undefined)`, the default
// for a field that has one (a placeholder), ignored by one that has none.
import { useState } from 'react';

export function NumberField(props: {
  label: string;
  value: number | undefined;
  min: number;
  max: number;
  step?: number;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onSave: (n: number | undefined) => void;
}) {
  const { label, value, min, max, step = 1, placeholder, disabled, className, onSave } = props;
  const [draft, setDraft] = useState<string>();
  const parse = (text: string) => (text.trim() && Number.isFinite(Number(text)) ? Math.round(Number(text)) : undefined);
  const commit = () => {
    if (draft === undefined) return;
    setDraft(undefined);
    if (!draft.trim()) return onSave(undefined);
    const n = parse(draft);
    if (n === undefined) return;
    const clamped = Math.min(max, Math.max(min, n));
    if (clamped !== value) onSave(clamped);
  };
  return (
    <input type="number" className={className} aria-label={label} min={min} max={max} step={step} placeholder={placeholder} disabled={disabled}
      value={draft ?? value ?? ''}
      onChange={(e) => {
        setDraft(e.target.value);
        const n = parse(e.target.value);
        if (n !== undefined && n >= min && n <= max && n !== value) onSave(n);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }} />
  );
}
