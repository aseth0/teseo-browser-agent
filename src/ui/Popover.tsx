// Icon button that opens a panel above the composer; closes on outside click or Escape. A menu in it
// (role="menu") starts on its first item, its arrows move between them, and Escape or a choice gives
// the focus back to the button.
import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { focusFirst, menuKeys, useDismiss } from './MenuButton';

interface Props {
  label: ReactNode;
  title: string;
  className?: string;
  children: (close: () => void) => ReactNode;
}

export function Popover({ label, title, className, children }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const close = (by: 'click' | 'escape' | 'choice') => {
    setOpen(false);
    if (by !== 'click') button.current?.focus();
  };

  useDismiss(ref, open, close);
  useEffect(() => {
    const at = panel.current;
    if (at && !at.contains(document.activeElement)) focusFirst(at.querySelector('[role="menu"]')); // not over a field's autoFocus
  }, [open]);
  // Only in a menu: elsewhere in the panel (a filter field) the arrows and Home, End stay the field's.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[role="menu"]')) menuKeys(e);
  };

  return (
    <div className="popover" ref={ref}>
      <button ref={button} className={`icon-button ${className ?? ''}`} title={title} aria-label={title} aria-expanded={open} onClick={() => setOpen(!open)}>
        {label}
      </button>
      {open && <div className="popover-panel" ref={panel} onKeyDown={onKeyDown}>{children(() => close('choice'))}</div>}
    </div>
  );
}
