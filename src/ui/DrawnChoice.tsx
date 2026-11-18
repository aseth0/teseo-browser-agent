// A choice of a few options as radio buttons, each over a schematic drawing of what it does, in the style
// of Vivaldi's tab stacking settings. A drawing is shapes in currentColor, on the group's `viewBox`: muted,
// the chosen one in the accent. Without a `legend`, the group around it says what it chooses.
import type { ReactNode } from 'react';

// `off`: it cannot be chosen (a build lacks it: core/build), greyed, its mark after its name.
export interface DrawnOption<T extends string> {
  id: T;
  label: string;
  drawing: ReactNode;
  off?: ReactNode;
}

interface Props<T extends string> {
  legend?: string;
  name: string; // of the radio buttons: one per page
  viewBox: string;
  options: readonly DrawnOption<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: 'small' | 'thumb'; // small drawings, for a choice among other fields; thumbnails, for many options
}

export const OUTLINE = { fill: 'none', stroke: 'currentColor', strokeWidth: 0.75 };

export function DrawnChoice<T extends string>({ legend, name, viewBox, options, value, onChange, size }: Props<T>) {
  return (
    <fieldset className={size ? `drawn-choice ${size}` : 'drawn-choice'}>
      {legend && <legend>{legend}</legend>}
      {options.map(({ id, label, drawing, off }) => (
        <label key={id} className={off ? 'drawn-option off' : 'drawn-option'}>
          <span className="drawn-option-name">
            <input type="radio" name={name} checked={value === id} disabled={!!off} onChange={() => onChange(id)} />
            {label}
            {off}
          </span>
          <svg className="drawn-option-drawing" viewBox={viewBox} fill="currentColor" aria-hidden="true">{drawing}</svg>
        </label>
      ))}
    </fieldset>
  );
}
