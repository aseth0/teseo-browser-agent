// Settings → Bubble: schematic drawings of where the chat opens (ui/DrawnChoice). A browser window with the
// page's lines, faint, and over them the chat: docked as the side panel, or floating as the widget places it,
// with its bar, a margin from the window's edges, its side and its height (widget/ui/floating-chat).
import type { ReactNode } from 'react';
import { OUTLINE } from '../DrawnChoice';

export const WINDOW_VIEW_BOX = '0 0 120 76';
const LEFT = 4;
const RIGHT = 116;
const TOP = 12; // the page's top, under the browser's bar
const BOTTOM = 72;

// The chat's lines: a question on one side, the answer on the other.
function ChatLines({ left, top, width }: { left: number; top: number; width: number }) {
  return (
    <>
      <rect x={left + width * 0.4} y={top} width={width * 0.6} height="2" rx="1" />
      <rect x={left} y={top + 6} width={width} height="2" rx="1" />
      <rect x={left} y={top + 10} width={width * 0.7} height="2" rx="1" />
    </>
  );
}

function Browser({ children, pageRight = RIGHT }: { children: ReactNode; pageRight?: number }) {
  const lines = pageRight - LEFT - 14;
  return (
    <>
      <rect {...OUTLINE} x={LEFT} y="4" width={RIGHT - LEFT} height={BOTTOM - 4} rx="3" />
      <path {...OUTLINE} d={`M${LEFT} ${TOP}H${RIGHT}`} />
      <g opacity="0.35">
        {[20, 27, 34, 41, 48, 55].map((y, n) => <rect key={y} x={LEFT + 7} y={y} width={lines * (n % 3 === 2 ? 0.6 : 1)} height="2" rx="1" />)}
      </g>
      {children}
    </>
  );
}

export function SidePanelDrawing() {
  const left = 80;
  return (
    <Browser pageRight={left}>
      <path {...OUTLINE} d={`M${left} ${TOP}V${BOTTOM}`} />
      <ChatLines left={left + 5} top={TOP + 7} width={RIGHT - left - 10} />
      <rect {...OUTLINE} x={left + 5} y={BOTTOM - 10} width={RIGHT - left - 10} height="6" rx="2" />
    </Browser>
  );
}

export function FloatingDrawing({ side = 'right', full = false }: { side?: 'right' | 'left'; full?: boolean }) {
  const width = 34;
  const margin = 4;
  const left = side === 'left' ? LEFT + margin : RIGHT - margin - width;
  const top = TOP + margin;
  const height = full ? BOTTOM - margin - top : 40;
  return (
    <Browser>
      <rect {...OUTLINE} x={left} y={top} width={width} height={height} rx="3" fill="var(--bg)" />
      <path {...OUTLINE} d={`M${left} ${top + 6}H${left + width}`} />
      <ChatLines left={left + 4} top={top + 11} width={width - 8} />
    </Browser>
  );
}
