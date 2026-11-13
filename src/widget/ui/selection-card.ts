// An action's card beside the selected text (widget/ui/speak-selection): the card the bubble shows
// (widget/ui/actions-run: its boxes, their speakers, the reasoning folded, going on in the chat), under
// the toolbar or over it, kept inside the window (widget/selection-bar cardPlace). Not moved nor resized:
// it goes with the selection. Its run is its own: closing it stops what runs and drops its boxes that wait.
import type { WidgetActionInfo } from '../protocol';
import { cardPlace } from '../selection-bar';
import { createActionRun, type CardSlot } from './actions-run';
import type { BoxSpeaker } from './box-speak';
import { el } from './dom';
import type { FloatingChat } from './floating-chat';
import { cardHead } from './pop';
import type { WidgetState } from './state';

const CARD_WIDTH = 320; // px, at most

interface SelectionCardParts {
  toChat: FloatingChat['toChat'];
  speaker: BoxSpeaker; // the page's box speakers, the bubble's card's too
  selection: () => string; // what an action takes
  bar: () => { x: number; y: number; height: number } | undefined; // the toolbar, in the window
  shown: (actionId: string | undefined) => void; // the action whose card is open, none once it closes
}

export function createSelectionCard(s: WidgetState, { toChat, speaker, selection, bar, shown }: SelectionCardParts) {
  const body = el('div', { className: 'pop-body' });
  // Focusable: a click on it takes the focus there (the selection's changes are then the card's own).
  const card = el('div', { className: 'pop sel-card', tabIndex: -1 }, body);
  card.hidden = true;
  const slot: CardSlot = {
    popBody: body,
    get selection() {
      return selection();
    },
  };

  const place = () => {
    const at = bar();
    if (!at || card.hidden) return;
    const p = cardPlace(at, { width: innerWidth, height: innerHeight }, CARD_WIDTH);
    Object.assign(card.style, {
      left: `${p.left}px`,
      top: p.top === undefined ? 'auto' : `${p.top}px`,
      bottom: p.bottom === undefined ? 'auto' : `${p.bottom}px`,
      width: `${p.width}px`,
      maxHeight: `${p.maxHeight}px`,
    });
  };
  const closePop = () => {
    slot.running?.abort();
    slot.popClosed?.();
    const was = !card.hidden;
    card.hidden = true;
    body.replaceChildren();
    if (was) shown(undefined);
  };
  const showPop = (action: WidgetActionInfo, title: string, ...content: Node[]) => {
    body.replaceChildren(cardHead(title, closePop), ...content);
    card.hidden = false;
    place();
    shown(action.id);
  };
  const press = createActionRun(s, { closePop, showPop }, toChat, speaker, slot);

  return { element: card, press, close: closePop, place, open: () => !card.hidden };
}
