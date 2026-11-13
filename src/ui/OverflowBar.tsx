// A bar of buttons that never wraps: as it gets narrower, those that do not fit go behind a ⋯
// button, starting from one side (`hideFrom`), and ⋯ shows them on a row of their own, where they
// work as in the bar (their menus too). `lead` and `tail` always stay (a title, Settings).
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

interface BarItem {
  key: string;
  node: ReactNode;
  push?: boolean; // the space before it grows (it and those after it go to the right)
}

interface Props {
  className: string;
  label: string; // what the bar is, for ⋯
  items: BarItem[];
  hideFrom: 'start' | 'end';
  lead?: ReactNode;
  tail?: ReactNode;
  trayAbove?: boolean; // ⋯'s row above the bar (by the message box) instead of below
}

const GAP = 4; // between the bar's parts, as its CSS
const GUESS = 28; // the width of one never seen yet

export function OverflowBar({ className, label, items, hideFrom, lead, tail, trayAbove }: Props) {
  const bar = useRef<HTMLDivElement>(null);
  const widths = useRef(new Map<string, number>()); // each item's, measured while in the bar
  const [hidden, setHidden] = useState(0);
  const [open, setOpen] = useState(false);
  const keys = items.map((i) => i.key).join('\n');

  useLayoutEffect(() => {
    const el = bar.current;
    if (!el) return;
    const fit = () => {
      for (const child of el.querySelectorAll<HTMLElement>(':scope > [data-bar-item]')) widths.current.set(child.dataset.barItem!, child.offsetWidth);
      const fixed = [...el.querySelectorAll<HTMLElement>(':scope > [data-bar-fixed]')].reduce((sum, c) => sum + c.offsetWidth + GAP, 0);
      const style = getComputedStyle(el);
      const room = el.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - fixed;
      const order = hideFrom === 'start' ? items : [...items].reverse(); // first to go first
      const width = (from: number) => order.slice(from).reduce((sum, i) => sum + (widths.current.get(i.key) ?? GUESS) + GAP, 0);
      let n = 0;
      if (width(0) > room) {
        const more = (el.querySelector<HTMLElement>(':scope > .bar-more')?.offsetWidth ?? GUESS) + GAP;
        n = 1;
        while (n < order.length && width(n) + more > room) n++;
      }
      setHidden((was) => (was === n ? was : n));
    };
    fit();
    // Again when the bar's width changes, and when one of its parts' does (a count, a name, a model,
    // shown once loaded; a slot filled later): the bar's own width stays the same then.
    const watch = new ResizeObserver(fit);
    watch.observe(el);
    for (const child of el.children) watch.observe(child);
    return () => watch.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- again when the items change (by their keys) or which are shown
  }, [keys, hideFrom, hidden]);
  useLayoutEffect(() => {
    if (!hidden) setOpen(false);
  }, [hidden]);

  const away = hideFrom === 'start' ? items.slice(0, hidden) : items.slice(items.length - hidden);
  const shown = hideFrom === 'start' ? items.slice(hidden) : items.slice(0, items.length - hidden);
  const more = hidden > 0 && (
    <button key="more" type="button" className="icon-button bar-more" aria-expanded={open} aria-label={`More: ${label}`} title={`${hidden} more`}
      onClick={() => setOpen(!open)}>⋯</button>
  );
  const tray = open && away.length > 0 && (
    <div className={`bar-tray${trayAbove ? ' above' : ''}`} role="group" aria-label={`More: ${label}`}>
      {away.map((i) => <span key={i.key} className="bar-item">{i.node}</span>)}
    </div>
  );
  return (
    <div className={`overflow-bar-wrap${trayAbove ? ' tray-above' : ''}`}>
      {trayAbove && tray}
      <div className={`overflow-bar ${className}`} ref={bar}>
        {lead !== undefined && <span data-bar-fixed className="bar-lead">{lead}</span>}
        {hideFrom === 'start' && more}
        {shown.map((i) => (
          <span key={i.key} data-bar-item={i.key} className={`bar-item${i.push ? ' push' : ''}`}>{i.node}</span>
        ))}
        {hideFrom === 'end' && more}
        {tail !== undefined && <span data-bar-fixed>{tail}</span>}
      </div>
      {!trayAbove && tray}
    </div>
  );
}
