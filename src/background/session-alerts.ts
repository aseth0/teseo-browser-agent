// A chat session's alerts (background/alerts): its questions while its chat is not in view, until each
// is answered; and its step limit, until a run starts again, the chat shows or closes. Whether the chat
// shows it says on its port (`view`); one that has not said (an older chat) counts as in view, one with
// no port open (a floating chat whose page reloaded) as not.
import { isObject } from '../core/util';
import type { BackgroundToPanel, ChatView } from '../core/protocol';
import { clearAlert, noteChatView, raiseAlert, type AlertWhere } from './alerts';
import { questionAlert } from './question-kinds';

// What a chat said of its view, checked.
export const chatViewOf = (m: unknown): ChatView | undefined => {
  if (!isObject(m) || typeof m.shown !== 'boolean') return undefined;
  return { shown: m.shown, ...(Number.isInteger(m.windowId) && { windowId: m.windowId as number }), ...(m.agentsPanel === true && { agentsPanel: true }) };
};

export function sessionAlerts(tab: number | undefined) {
  const self = {};
  const stepId = `step:${crypto.randomUUID()}`;
  let view: ChatView | undefined;
  let connected = true;
  const inView = () => connected && (view?.shown ?? true);
  const where = (): AlertWhere => (tab === undefined ? { windowId: view?.windowId, sidePanel: true } : { tabId: tab, windowId: view?.windowId });

  return {
    // What the session sends its chat: a question, or the step limit, may alert.
    sent(m: BackgroundToPanel) {
      if (m.type === 'step-limit') {
        void raiseAlert(stepId, 'step-limit', { message: `It stopped after ${m.steps} steps: open the chat to continue.`, where: where(), inView: inView() });
        return;
      }
      if (!('id' in m) || typeof m.id !== 'string') return;
      const a = questionAlert(m, view?.agentsPanel);
      if (a) void raiseAlert(m.id, a.kind, { message: a.message, where: where(), inView: inView() });
    },
    settled: (id: string) => clearAlert(id),
    // The chat said whether it shows (or its port changed: unknown until it says).
    view(v: ChatView | undefined) {
      view = v;
      noteChatView(self, v);
      if (inView()) clearAlert(stepId);
    },
    connected(on: boolean) {
      connected = on;
      if (!on) {
        view = undefined;
        noteChatView(self, undefined);
        clearAlert(stepId); // its notice went with the chat
      }
    },
    runStarts: () => clearAlert(stepId),
  };
}
