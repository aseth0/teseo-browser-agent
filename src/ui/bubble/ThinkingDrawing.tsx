// Settings → Bubble, While it works: the bubble and what it shows then, still, at its size on the pages (44
// px, widget/ui/style): a ring around it, part of the way; a pulse fading out of it; a thought bubble at its
// top right; or its eyes looking up, with a flat mouth (widget/bubble-look).
import type { Appearance } from '../../storage/settings-types';
import { OUTLINE } from '../DrawnChoice';

export const THINKING_VIEW_BOX = '-20 -24 84 78';
const CENTER = 22;
const SHEET = { fill: 'var(--bg)' };

export function ThinkingDrawing({ as }: { as: NonNullable<Appearance['bubbleThinking']> | 'ring' }) {
  return (
    <>
      {as === 'pulse' && (
        <>
          <circle cx={CENTER} cy={CENTER} r="31" opacity="0.15" />
          <circle cx={CENTER} cy={CENTER} r="26" opacity="0.3" />
        </>
      )}
      {as === 'ring' && <path d="M4.3 4.3A25 25 0 0 1 39.7 39.7" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />}
      <circle cx={CENTER} cy={CENTER} r={CENTER} />
      {as === 'thought' && (
        <>
          <rect {...OUTLINE} {...SHEET} x="34" y="-20" width="26" height="16" rx="8" />
          <circle {...OUTLINE} {...SHEET} cx="38" cy="0" r="2.5" />
          <circle cx="40" cy="-12" r="2" /><circle cx="47" cy="-12" r="2" /><circle cx="54" cy="-12" r="2" />
        </>
      )}
      {as === 'face' && (
        <g {...SHEET}>
          <ellipse cx="14.5" cy="19" rx="4.5" ry="5.5" /><ellipse cx="29.5" cy="19" rx="4.5" ry="5.5" />
          <circle cx="16" cy="16.5" r="2.3" fill="currentColor" /><circle cx="31" cy="16.5" r="2.3" fill="currentColor" />
          <rect x="16" y="29" width="12" height="2.5" rx="1.25" />
        </g>
      )}
    </>
  );
}
