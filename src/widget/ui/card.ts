// The card of an action, beside the bubble: what it found, the model's answer as it is written, a
// write to confirm. Moved by its head, resized from any edge (its size kept per site).
import { actionIcon, type WidgetActionInfo } from '../protocol';
import { createActionRun } from './actions-run';
import { actLabel, trustedButton } from './dom';
import type { BoxSpeaker } from './box-speak';
import type { FloatingChat } from './floating-chat';
import { createPop } from './pop';
import type { WidgetHost, WidgetState } from './state';

export function createCard(s: WidgetState, host: WidgetHost, toChat: FloatingChat['toChat'], speaker: BoxSpeaker) {
  const pop = createPop(s, host);
  const press = createActionRun(s, pop, toChat, speaker);

  const actionButton = (action: WidgetActionInfo) => {
    const button = trustedButton({ className: 'act', title: action.name, ariaLabel: action.name }, () => press(action));
    button.append(...actLabel(actionIcon(action), action.name));
    button.dataset.action = action.id;
    return button;
  };

  return { close: pop.closePop, handle: pop.popHandle, actionButton };
}
