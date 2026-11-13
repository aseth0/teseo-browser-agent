// What a capture from the popup or a shortcut works out before and after it captures: which chat
// gets it, and a whole page cut into parts an attached image can show.
import { handoffTo, type HandoffTo } from '../widget/protocol';

// The tops of the parts of a page `total` high, `part` each, top to bottom: as many as `room`
// images allow, and how many more there would have been.
export function pagePlan(total: number, part: number, room: number): { tops: number[]; leftOut: number } {
  const count = Math.max(1, Math.ceil(total / part));
  const kept = Math.max(0, Math.min(room, count));
  return { tops: Array.from({ length: kept }, (_, i) => i * part), leftOut: count - kept };
}

export const leftOutNote = (n: number, max: number): string =>
  `${n === 1 ? '1 part' : `${n} parts`} of the page left out: at most ${max} images per message (Settings → Limits).`;

// Which chat gets a capture or a widget's handoff: the one floating on the tab, as it is; otherwise the
// side panel, opened in the pin's mode: the window's, or with the pin off the tab's own. The pin not
// known yet (undefined): either of them.
export function chatTarget(tabId: number, floating: boolean, follows: boolean | undefined): { panel: boolean; to: HandoffTo } {
  if (floating) return { panel: false, to: handoffTo({ tab: tabId }) };
  if (follows === undefined) return { panel: true, to: handoffTo({ panelTab: tabId, anyPanel: true }) };
  return { panel: true, to: handoffTo(follows ? {} : { panelTab: tabId }) };
}
