// The bubble's eyes following the mouse pointer (Settings → Bubble → Eyes), on the page it is on.
// One passive pointermove listener on the window, there only while they follow: the bubble shown,
// the tab visible and the system not asking for reduced motion. It keeps where the pointer is and
// asks for at most one frame, which sets two CSS variables (--lx, --ly) on the bubble's host; no
// layout is read (the bubble's place is known). Over a frame (a video, the floating chat) the page
// gets no pointer events: the eyes keep looking where they last saw it. Out of the window, or while
// the bubble is dragged, they look ahead. `signal`: the widget gone from the page, nothing of them stays.
import { lookOffset } from '../bubble-look';
import { BUBBLE } from './style';
import type { WidgetState } from './state';

export function createEyes(s: WidgetState, signal: AbortSignal) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let listening = false;
  let frame = 0;
  let pointer: { x: number; y: number } | undefined;

  const set = (x: number, y: number) => {
    s.host?.style.setProperty('--lx', x.toFixed(2));
    s.host?.style.setProperty('--ly', y.toFixed(2));
  };
  const look = () => {
    frame = 0;
    const eyesY = s.drawn?.eyesY;
    if (!pointer || eyesY === undefined || s.bubble.classList.contains('dragging')) return set(0, 0);
    const { x, y } = lookOffset(pointer.x - (s.at.x + BUBBLE / 2), pointer.y - (s.at.y + eyesY));
    set(x, y);
  };
  const onMove = (e: PointerEvent) => {
    if (!s.host) return sync(); // the widget was taken away
    pointer = { x: e.clientX, y: e.clientY };
    frame ||= requestAnimationFrame(look);
  };
  const onLeave = () => {
    pointer = undefined;
    frame ||= requestAnimationFrame(look);
  };

  // On or off as the settings, the tab and the system now say.
  const sync = () => {
    const wanted = !signal.aborted && !!s.host && !s.place.hidden && !!s.drawn?.look.follows && !document.hidden && !reduced.matches;
    if (wanted === listening) return;
    listening = wanted;
    if (wanted) {
      addEventListener('pointermove', onMove, { passive: true, capture: true });
      document.documentElement.addEventListener('pointerleave', onLeave);
    } else {
      removeEventListener('pointermove', onMove, { capture: true });
      document.documentElement.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(frame);
      frame = 0;
      pointer = undefined;
      set(0, 0);
    }
  };
  document.addEventListener('visibilitychange', sync, { signal });
  reduced.addEventListener('change', sync, { signal });
  signal.addEventListener('abort', sync, { once: true }); // the bubble taken away first: they stop following
  return { sync };
}
