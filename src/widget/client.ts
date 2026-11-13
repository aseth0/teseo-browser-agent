// Running an action from the widget or Settings → Actions' Try: over a port, with the model's answer
// as it comes, a write to confirm when the site asks for it, and the reply last. The signal closes
// the port, which stops the run (and denies what was waiting).
import { browser } from 'wxt/browser';
import { STOPPED, WIDGET_RUN, type ActionConfirm, type CardDecision, type WidgetConfirmReply, type WidgetRunEvent, type WidgetRunReply, type WidgetRunRequest } from './protocol';
import type { HastNode } from '../markdown/tree';
import type { StepTrace } from './steps';

interface RunHandlers {
  onDelta(kind: 'text' | 'reasoning', text: string): void;
  onMarkdown?(tree: HastNode): void; // the answer so far as Markdown, now and then
  onConfirm?(request: ActionConfirm): Promise<CardDecision>; // none: denied
  onStep?(trace: StepTrace): void; // an action with steps, as they go
}

export function runAction(request: Omit<WidgetRunRequest, 'type'>, handlers: RunHandlers, signal?: AbortSignal): Promise<WidgetRunReply | undefined> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve({ error: STOPPED }); // never asked
    let port: Browser.runtime.Port;
    try {
      port = browser.runtime.connect({ name: WIDGET_RUN });
    } catch {
      return resolve(undefined); // the extension was reloaded: this page's script is cut off
    }
    const done = (reply: WidgetRunReply | undefined) => {
      resolve(reply);
      port.disconnect();
    };
    const answer = async (id: string, confirm: ActionConfirm) => {
      const decision = handlers.onConfirm ? await handlers.onConfirm(confirm) : 'deny';
      if (!signal?.aborted) port.postMessage({ type: 'confirm-reply', id, decision } satisfies WidgetConfirmReply);
    };
    port.onMessage.addListener((evt: WidgetRunEvent) => {
      if (evt.type === 'delta') handlers.onDelta(evt.kind, evt.text);
      else if (evt.type === 'markdown') handlers.onMarkdown?.(evt.tree);
      else if (evt.type === 'step') handlers.onStep?.(evt.step);
      else if (evt.type === 'confirm') {
        const { type: _type, id, ...confirm } = evt;
        void answer(id, confirm);
      } else done(evt.reply);
    });
    port.onDisconnect.addListener(() => resolve(undefined));
    signal?.addEventListener('abort', () => done({ error: STOPPED }), { once: true });
    port.postMessage({ type: WIDGET_RUN, ...request } satisfies WidgetRunRequest);
  });
}
