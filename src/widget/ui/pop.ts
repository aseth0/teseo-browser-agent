// The pop-up beside the bubble that shows an action's card: shown, closed, moved by its head, resized
// from any edge (its size kept per site).
import type { WidgetActionInfo } from '../protocol';
import { el, trustedButton } from './dom';
import { clamp, resizeHandle, type Box, type Edge } from './pointer';
import type { WidgetHost, WidgetState } from './state';
import { MIN_H, MIN_W } from './style';

export type Pop = ReturnType<typeof createPop>;

// A card's head: its title, and ✕ to close it.
export const cardHead = (title: string, close: () => void) =>
  el('div', { className: 'pop-head' }, el('span', { textContent: title }), trustedButton({ className: 'icon', textContent: '✕', title: 'Close', ariaLabel: 'Close' }, close));

export function createPop(s: WidgetState, { render, savePlace }: WidgetHost) {
  const closePop = () => {
    s.running?.abort();
    s.popClosed?.();
    s.pop.hidden = true;
    s.pop.style.left = s.pop.style.top = s.pop.style.right = s.pop.style.bottom = ''; // next time, beside the bubble again
    for (const b of s.menu.querySelectorAll('.act.on')) b.classList.remove('on');
    render();
  };

  // The card, from now on placed by its own left and top (from the bubble's corner), not beside the
  // bubble: until it closes.
  const unpinPop = (): { box: Box; origin: DOMRect } | undefined => {
    if (!s.host) return;
    const box = s.pop.getBoundingClientRect();
    const origin = s.host.getBoundingClientRect();
    const left = box.left - origin.left;
    const top = box.top - origin.top;
    Object.assign(s.pop.style, { right: 'auto', bottom: 'auto', left: `${left}px`, top: `${top}px` });
    return { box: { left, top, width: box.width, height: box.height }, origin };
  };
  // Resized: its size kept for the site.
  const popHandle = (edge: Edge) => resizeHandle(edge, () => {
    const from = unpinPop();
    return from && { box: from.box, min: [MIN_W, MIN_H], max: [innerWidth * 0.9, innerHeight * 0.85] };
  }, (b) => Object.assign(s.pop.style, { width: `${b.width}px`, height: `${b.height}px`, left: `${b.left}px`, top: `${b.top}px` }),
  (b) => void savePlace({ width: Math.round(b.width), height: Math.round(b.height) }));
  // Moved by its head, kept inside the window.
  const popDrag = (head: HTMLElement) => head.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || e.button !== 0 || (e.target as Element).closest('button')) return;
    const from = unpinPop();
    if (!from) return;
    const { box, origin } = from;
    head.setPointerCapture(e.pointerId);
    head.classList.add('dragging');
    const move = (m: PointerEvent) => Object.assign(s.pop.style, {
      left: `${clamp(box.left + m.clientX - e.clientX, -origin.left, innerWidth - origin.left - box.width)}px`,
      top: `${clamp(box.top + m.clientY - e.clientY, -origin.top, innerHeight - origin.top - box.height)}px`,
    });
    head.addEventListener('pointermove', move);
    // However the drag ends (let go, or cancelled by the browser): else the card would follow the pointer.
    head.addEventListener('lostpointercapture', () => {
      head.removeEventListener('pointermove', move);
      head.classList.remove('dragging');
    }, { once: true });
  });

  // A card in the pop-up, for one action.
  const showPop = (action: WidgetActionInfo, title: string, ...content: Node[]) => {
    const head = cardHead(title, closePop);
    popDrag(head);
    s.popBody.replaceChildren(head, ...content);
    s.pop.hidden = false;
    for (const b of s.menu.querySelectorAll<HTMLElement>('.act')) b.classList.toggle('on', b.dataset.action === action.id);
    render();
  };

  return { closePop, popHandle, showPop };
}
