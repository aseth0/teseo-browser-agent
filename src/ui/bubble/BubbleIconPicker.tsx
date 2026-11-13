import { useRef, useState } from 'react';
import { BUBBLE_ICONS, bubbleIconLabel } from '../../widget/bubble-icons';
import { LucideIcon } from '../LucideIcon';
import { useDismiss } from '../MenuButton';
import type { BubbleProps } from './BubbleLookOptions';

// The icon, as the agents': a button showing it, opening a grid of icons found by name.
export function BubbleIconPicker({ look, setLook }: BubbleProps) {
  const chosen = look.bubbleIcon;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  const set = (bubbleIcon: string | undefined) => {
    setLook({ bubbleIcon });
    setOpen(false);
  };
  const ids = Object.keys(BUBBLE_ICONS).filter((id) => bubbleIconLabel(id).toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <>
      <div className="icon-field">
        <span>Icon</span>
        <div className="icon-picker" ref={ref}>
          <button type="button" className="icon-picker-button" title={chosen ? `${bubbleIconLabel(chosen)}: change it` : '✦ (default): change it'} aria-label="Bubble icon" aria-expanded={open} onClick={() => setOpen(!open)}>
            {chosen && BUBBLE_ICONS[chosen] ? <LucideIcon node={BUBBLE_ICONS[chosen]} size={18} /> : <span className="icon-default">✦</span>}
          </button>
          {open && (
            <div className="icon-picker-panel bubble-icon-panel" role="dialog" aria-label="Choose the bubble's icon">
              <input type="search" value={query} placeholder="Find an icon…" aria-label="Find an icon" onChange={(e) => setQuery(e.target.value)} />
              <div className="icon-grid" role="radiogroup" aria-label="Bubble icon">
                {!query.trim() && (
                  <button role="radio" aria-checked={!chosen} className="icon-choice" title="✦ (default)" aria-label="Default" onClick={() => set(undefined)}>
                    <span className="icon-default">✦</span>
                  </button>
                )}
                {ids.map((id) => (
                  <button key={id} role="radio" aria-checked={chosen === id} className="icon-choice" title={bubbleIconLabel(id)} aria-label={bubbleIconLabel(id)} onClick={() => set(id)}>
                    <LucideIcon node={BUBBLE_ICONS[id]!} />
                  </button>
                ))}
                {!ids.length && <span className="hint">No icon matches.</span>}
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="hint">Icons by Lucide (ISC license).</p>
    </>
  );
}
