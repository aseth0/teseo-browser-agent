// The message box's top edge (MentionComposer): dragged, it sets the box's height.
import { useState, type PointerEvent, type RefObject } from 'react';

const MAX_BOX_SHARE = 0.7; // of the window, dragged: the messages stay in sight

// The box's top edge (the box sits at the bottom of the chat, so it grows upwards): dragged, it sets
// the box's height, kept while the chat is open; a double click gives the box back its own height,
// growing with its text. For the pointer only: the box already grows as you type.
export function BoxGrip({ box, onHeight }: { box: RefObject<HTMLTextAreaElement | null>; onHeight: (h: number | undefined) => void }) {
  const [dragging, setDragging] = useState(false);
  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    const el = box.current;
    if (!el || e.button !== 0) return;
    e.preventDefault(); // no text selection while dragging
    const from = e.clientY;
    const style = getComputedStyle(el);
    const start = parseFloat(style.height);
    const least = parseFloat(style.minHeight) || 0; // its min-height (.composer textarea)
    const scale = el.getBoundingClientRect().height / start || 1; // the chat's zoom
    const grip = e.currentTarget;
    const move = (m: globalThis.PointerEvent) =>
      onHeight(Math.round(Math.max(least, Math.min(start + (from - m.clientY) / scale, (innerHeight * MAX_BOX_SHARE) / scale))));
    const end = () => {
      grip.removeEventListener('pointermove', move);
      setDragging(false);
    };
    grip.setPointerCapture(e.pointerId);
    grip.addEventListener('pointermove', move);
    grip.addEventListener('lostpointercapture', end, { once: true });
    setDragging(true);
  };
  return (
    <div
      className={dragging ? 'box-grip dragging' : 'box-grip'}
      aria-hidden="true"
      title="Drag to resize the message box; double-click to fit it to its text"
      onPointerDown={onPointerDown}
      onDoubleClick={() => onHeight(undefined)}
    />
  );
}
