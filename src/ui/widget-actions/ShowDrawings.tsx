// Settings → Actions, what an action shows: schematic drawings of its result (ui/DrawnChoice). The card beside
// the bubble, its bottom level with it, with its head and its boxes, each a label over its value (widget/ui/
// result); or the bubble alone with its badge, closer.
import type { ReactNode } from 'react';
import { OUTLINE } from '../DrawnChoice';

export const SHOW_VIEW_BOX = '0 0 120 76';
const CARD_LEFT = 6;
const BOX_LEFT = CARD_LEFT + 4;
const BOX_WIDTH = 74;
const INSET = BOX_LEFT + 4;

// A box of the card: its label, a short thick line, over the value's lines.
function Box({ top, lines }: { top: number; lines: number[] }) {
  return (
    <>
      <rect {...OUTLINE} x={BOX_LEFT} y={top} width={BOX_WIDTH} height={9 + lines.length * 4} rx="2.5" />
      <rect x={INSET} y={top + 3} width="20" height="2.5" rx="1.25" />
      <g opacity="0.55">
        {lines.map((width, n) => <rect key={n} x={INSET} y={top + 8 + n * 4} width={width} height="1.5" rx="0.75" />)}
      </g>
    </>
  );
}

function Card({ children }: { children: ReactNode }) {
  return (
    <>
      <rect {...OUTLINE} x={CARD_LEFT} y="6" width="82" height="64" rx="4" />
      <rect x={BOX_LEFT} y="10" width="30" height="2" rx="1" opacity="0.55" />
      {children}
      <circle cx="104" cy="60" r="10" />
    </>
  );
}

export const FieldsDrawing = () => <Card><Box top={16} lines={[40]} /><Box top={32} lines={[28]} /><Box top={48} lines={[48]} /></Card>;
export const TextDrawing = () => <Card><Box top={16} lines={[64, 58, 64, 60, 38, 52, 30, 44]} /></Card>;

export function BadgeDrawing() {
  return (
    <>
      <circle cx="60" cy="40" r="19" />
      <circle cx="74" cy="26" r="8.5" fill="var(--bg)" stroke="currentColor" strokeWidth="1" />
      <text x="74" y="29.5" textAnchor="middle" fontSize="10" fontWeight="700">3</text>
    </>
  );
}
