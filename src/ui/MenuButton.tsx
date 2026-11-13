// A button with a ▾ that opens a menu of choices (e.g. Import ▾: from a file, from JSON). A choice
// may be a checkbox that stays in the menu.
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from 'react';
import { useStableCallback } from './useStableCallback';

export type MenuItem = { label: string; onSelect: () => void } | { label: string; checked: boolean; onToggle: (checked: boolean) => void; title?: string };

// A menu or panel that a click anywhere outside `ref`, or Escape, closes. `onClose` is told which,
// so that after Escape the focus can go back to what opened it (after a click it stays where it went).
export function useDismiss(ref: RefObject<HTMLElement | null>, open: boolean, onClose: (by: 'click' | 'escape') => void) {
  const close = useStableCallback(onClose);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) close('click');
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close('escape');
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, open, close]);
}

// What takes the focus for a menu item: the item, or the checkbox inside one that is a <label>.
const focusable = (item: HTMLElement) => (item.tabIndex >= 0 ? item : item.querySelector<HTMLElement>('input') ?? item);

// ↑ ↓ (and Home, End) move between a menu's items, as in any menu.
export function menuKeys(e: ReactKeyboardEvent<HTMLElement>) {
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
  const at = items.findIndex((i) => i.contains(document.activeElement));
  const to = { ArrowDown: at + 1, ArrowUp: at - 1, Home: 0, End: items.length - 1 }[e.key];
  if (to === undefined || !items.length) return;
  e.preventDefault();
  focusable(items[(to + items.length) % items.length]!).focus();
}

// A menu starts on its first item (MenuButton's when opened from the keyboard, a Popover's always).
export function focusFirst(menu: HTMLElement | null) {
  const first = menu?.querySelector<HTMLElement>('[role^="menuitem"]');
  if (first) focusable(first).focus();
}

// `disabled`: shown off, its title saying why.
export function MenuButton({ label, items, disabled, title }: { label: string; items: MenuItem[]; disabled?: boolean; title?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const opening = useRef(false); // from the keyboard
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div className="split-button" ref={ref}>
      <button aria-haspopup="menu" aria-expanded={open} disabled={disabled} title={title} onClick={(e) => { opening.current = e.detail === 0; setOpen(!open); }}>
        {label} ▾
      </button>
      {open && (
        <div className="split-menu" role="menu" aria-label={label} onKeyDown={menuKeys} ref={(m) => void (opening.current && focusFirst(m))}>
          {items.map((item) =>
            'onSelect' in item ? (
              <button key={item.label} role="menuitem"
                onClick={() => {
                  setOpen(false);
                  item.onSelect();
                }}>
                {item.label}
              </button>
            ) : (
              <label key={item.label} className="menu-check" role="menuitemcheckbox" aria-checked={item.checked} title={item.title}>
                <input type="checkbox" checked={item.checked} onChange={(e) => item.onToggle(e.target.checked)} /> {item.label}
              </label>
            ),
          )}
        </div>
      )}
    </div>
  );
}
