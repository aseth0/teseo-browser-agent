// The divider between the agent manager's list and its chat, dragged; where it was left is kept in
// this page's localStorage (a convenience for this browser only, which may refuse it).
import { useCallback, useState, type PointerEvent } from 'react';

const KEY = 'manager:split';
const LIST_MIN = 380; // its head: the title, History and + New agent
const CHAT_MIN = 320;
const DEFAULT_WIDTH = 420;

// The list's width, leaving both sides wide enough.
export const clampSplit = (px: number, total: number) => Math.round(Math.max(LIST_MIN, Math.min(px, total - CHAT_MIN)));

function stored(): number {
  try {
    const n = Number(localStorage.getItem(KEY));
    return n > 0 ? n : DEFAULT_WIDTH;
  } catch {
    return DEFAULT_WIDTH;
  }
}

export function useSplit(): { width: number; onPointerDown: (e: PointerEvent<HTMLElement>) => void } {
  const [width, setWidth] = useState(stored);
  const onPointerDown = useCallback((e: PointerEvent<HTMLElement>) => {
    const handle = e.currentTarget;
    const left = handle.parentElement?.getBoundingClientRect().left ?? 0;
    const total = handle.parentElement?.clientWidth ?? window.innerWidth;
    handle.setPointerCapture(e.pointerId);
    let last = width;
    const move = (m: globalThis.PointerEvent) => setWidth((last = clampSplit(m.clientX - left, total)));
    // Ends when the capture goes: on pointerup, and on pointercancel too (as every drag here does).
    const end = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('lostpointercapture', end);
      try {
        localStorage.setItem(KEY, String(last));
      } catch {
        // kept for this visit only
      }
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('lostpointercapture', end);
  }, [width]);
  return { width, onPointerDown };
}
