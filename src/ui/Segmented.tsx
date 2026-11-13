// One choice among a few, as joined buttons: a group of toggle buttons, the chosen one pressed.
import type { ReactNode } from 'react';

interface Segment<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
  ariaLabel?: string; // when the label alone says too little
}

export function Segmented<T extends string>({ label, value, options, onChange, className }: {
  label: string; // of the group
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  className?: string; // compact, small
}) {
  return (
    <span className={className ? `segmented ${className}` : 'segmented'} role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} aria-label={o.ariaLabel} aria-pressed={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </span>
  );
}
