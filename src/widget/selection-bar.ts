// The toolbar beside the selected text (widget/ui/speak-selection): which actions it has, how wide it is,
// and where an action's card goes from it. Plain values, no page: the widget draws them.
import type { WidgetActionInfo } from './protocol';

export const SPEAKER = 26; // px: the speaker alone, a round button
export const BAR_BUTTON = 24; // px: each button of the toolbar
export const BAR_PAD = 2; // px: inside the pill, on each side (and its 1px border)
export const SEPARATOR_GAP = 4; // px on each side of the line between the speaker and the actions
const SEPARATOR = 1 + 2 * SEPARATOR_GAP; // px: that line, with its room
export const MAX_SHOWN = 4; // actions shown as buttons; the others behind "…"

// The actions marked to show beside the selection among the page's (the background marks only those that
// may: widget/actions showsBesideSelection). The first ones as buttons, the rest in the "…" list.
export function besideActions(actions: WidgetActionInfo[]): { shown: WidgetActionInfo[]; more: WidgetActionInfo[] } {
  const marked = actions.filter((a) => a.besideSelection);
  return { shown: marked.slice(0, MAX_SHOWN), more: marked.slice(MAX_SHOWN) };
}

// Its width: the speaker alone as today; with actions, a pill with the speaker (if on), a line, and a
// button per action (and "…").
export function barWidth(speaker: boolean, buttons: number): number {
  if (!buttons) return SPEAKER;
  return 2 + 2 * BAR_PAD + (speaker ? BAR_BUTTON + SEPARATOR : 0) + buttons * BAR_BUTTON;
}

const GAP = 6; // px between the toolbar and the card
const MARGIN = 8; // px the card keeps from the window's edges
const ROOM = 200; // px under the toolbar that are enough for the card, even when there is more above

interface CardPlace {
  left: number; // from the toolbar's left
  top?: number; // from the toolbar's top: under it
  bottom?: number; // from the toolbar's top, upwards: over it
  width: number;
  maxHeight: number;
}

// Where an action's card goes, from the toolbar (`bar`, in the window): under it, or over it when there
// is more room there and not enough under; its left as the toolbar's, moved to stay inside the window.
export function cardPlace(bar: { x: number; y: number; height: number }, view: { width: number; height: number }, cardWidth: number): CardPlace {
  const width = Math.max(0, Math.min(cardWidth, view.width - 2 * MARGIN));
  const left = Math.max(MARGIN, Math.min(bar.x, view.width - MARGIN - width)) - bar.x;
  const below = view.height - (bar.y + bar.height + GAP) - MARGIN;
  const above = bar.y - GAP - MARGIN;
  if (below >= ROOM || below >= above) return { left, top: bar.height + GAP, width, maxHeight: Math.max(0, below) };
  return { left, bottom: bar.height + GAP, width, maxHeight: Math.max(0, above) };
}
