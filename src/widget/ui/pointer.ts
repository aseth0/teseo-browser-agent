// Boxes moved and resized with the pointer (the card, the floating chat).
import { el } from './dom';

export const RESIZE_EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const;
export type Edge = (typeof RESIZE_EDGES)[number];
export type Box = { left: number; top: number; width: number; height: number };
export const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(v, max));

// A handle on an edge or corner that resizes a box (the card, the floating chat): the opposite one
// stays where it is. `begin` gives the box as it is and its limits (none: not now).
export function resizeHandle(edge: Edge, begin: () => { box: Box; min: [number, number]; max: [number, number] } | undefined, apply: (box: Box) => void, done: (box: Box) => void) {
  const handle = el('div', { className: `rz ${edge}` });
  handle.addEventListener('pointerdown', (e) => {
    if (!e.isTrusted || e.button !== 0) return;
    const start = begin();
    if (!start) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const { box: from, min, max } = start;
    let box = from;
    const move = (m: PointerEvent) => {
      const dx = m.clientX - e.clientX;
      const dy = m.clientY - e.clientY;
      const width = clamp(edge.includes('e') ? from.width + dx : edge.includes('w') ? from.width - dx : from.width, min[0], max[0]);
      const height = clamp(edge.includes('s') ? from.height + dy : edge.includes('n') ? from.height - dy : from.height, min[1], max[1]);
      box = { width, height, left: edge.includes('w') ? from.left + from.width - width : from.left, top: edge.includes('n') ? from.top + from.height - height : from.top };
      apply(box);
    };
    handle.addEventListener('pointermove', move);
    // Ended however it ends: let go, or cancelled by the browser (a gesture, the window losing focus);
    // either way the pointer capture is lost.
    handle.addEventListener('lostpointercapture', () => {
      handle.removeEventListener('pointermove', move);
      done(box);
    }, { once: true });
  });
  return handle;
}
