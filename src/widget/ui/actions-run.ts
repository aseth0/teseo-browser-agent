// Running an action from its button, in its card: at once, or asking for its text first; its answer
// streamed into the card, a write to confirm there; or its message sent to the chat. The same card beside
// the bubble (widget/ui/pop) and beside the selected text (widget/ui/selection-card), each in its own slot.
import { runAction } from '../client';
import type { WidgetActionInfo, WidgetRunReply } from '../protocol';
import { isEnter } from '../../ui/enter';
import { confirmCard } from './confirm';
import { el, foldableTree, keepFoldFocus } from './dom';
import type { FloatingChat } from './floating-chat';
import { readValues } from './loads';
import type { Pop } from './pop';
import { result } from './result';
import type { BoxSpeaker } from './box-speak';
import type { WidgetState } from './state';

// Where a card shows, and what it runs with: the action running in it, what its closing calls, its body,
// and the selection an action takes. The bubble's is the widget's state itself.
export interface CardSlot {
  running?: AbortController; // the action whose card is open, while it runs
  popClosed?: () => void; // the card went: its boxes that wait are dropped
  readonly popBody: HTMLElement;
  readonly selection: string;
}

// What an action's button does (press), in its card (`pop`), in its slot (none: the bubble's). `speaker`:
// the speakers of the boxes, one for every card of the page (widget/ui/box-speak): their keys are the
// background's, "action:<action>:<box>", whichever card shows them.
export function createActionRun(s: WidgetState, { closePop, showPop }: Pick<Pop, 'closePop' | 'showPop'>, toChat: FloatingChat['toChat'], speaker: BoxSpeaker, slot: CardSlot = s) {
  // What it found, or its error (a copy without the clipboard API goes through the card); its boxes of
  // text read aloud by their speakers.
  slot.popClosed = () => speaker.drop?.();
  const outcome = (action: WidgetActionInfo, reply: WidgetRunReply | undefined, folded?: Set<number>) => {
    speaker.newCard?.();
    return result(reply, toChat, () => slot.popBody, folded, { actionId: action.id, speaker });
  };
  // Its card shows what it found: its boxes of text read aloud now, if it reads them on its own.
  const readShown = (action: WidgetActionInfo) => {
    if (action.readsAloud) speaker.readOnItsOwn?.(action.id);
  };

  // The card while it runs: the model's reasoning folded, and its answer as it is written (not a
  // JSON one, which is only shown cut into its boxes); then the reply, the reasoning kept.
  // At once on a click: a text action with the page's selection, kept editable above the answer.
  const run = async (action: WidgetActionInfo, input: string, reads?: Record<string, string>) => {
    if (action.openChat) return openChatWith(action, input, reads);
    const asks = action.input === 'text';
    const title = input && !asks ? `${action.name} · ${input}` : action.name;
    const ask = asks ? askField(action, input) : undefined;
    const top = ask ? [ask.row] : [];
    const own = (slot.running = new AbortController()); // press() stopped the one before
    const thought = el('div', { className: 'text' });
    const thinking = el('details', { className: 'thinking' }, el('summary', { textContent: 'Reasoning' }), thought);
    const said = el('div', { className: 'text' });
    const status = el('div', { className: 'muted', textContent: 'Running…' });
    const asking = el('div'); // a write to confirm, while it waits for the user
    thinking.hidden = said.hidden = true;
    showPop(action, title, ...top, thinking, said, asking, status);
    ask?.field.focus(); // to change the text and run it again with Enter
    let rendered = false; // the answer so far came as Markdown
    let written = ''; // the answer so far, as it streams
    const stream = action.readsAloud && !action.json ? speaker.stream?.(action.id) : undefined; // read as it is written
    const folded = new Set<number>(); // its headings folded so far
    const shown = () => {
      thinking.hidden = !thought.textContent;
      said.hidden = !said.textContent;
      status.hidden = !said.hidden;
    };
    const reply = await runAction({ id: action.id, input, ...(reads && { reads }) }, {
      onDelta: (kind, text) => {
        if (own.signal.aborted) return;
        if (kind === 'reasoning') thought.textContent += text;
        else if (action.json) status.textContent = 'Writing…';
        else {
          written += text;
          stream?.grew(written);
          if (!rendered) said.textContent += text; // as text until the first Markdown comes
        }
        shown();
      },
      onMarkdown: (tree) => {
        if (own.signal.aborted) return;
        rendered = true;
        said.className = 'markdown';
        // Not under a press: a button replaced before its release would miss the click. The next
        // Markdown has this one's text too.
        if (said.querySelector('.fold-toggle:active')) return;
        keepFoldFocus(said, () => said.replaceChildren(...foldableTree(tree, folded)));
        shown();
      },
      onConfirm: (request) => new Promise((resolve) => {
        status.hidden = true;
        asking.replaceChildren(confirmCard(request, (decision) => {
          asking.replaceChildren();
          status.hidden = false;
          resolve(decision);
        }));
      }),
    }, own.signal);
    if (own.signal.aborted) return;
    slot.running = undefined;
    const typing = ask?.field.matches(':focus'); // the card is rebuilt: the field keeps the focus
    keepFoldFocus(slot.popBody, () => showPop(action, title, ...top, ...(thought.textContent ? [thinking] : []), outcome(action, reply, folded)));
    if (typing) ask!.field.focus();
    if (!stream?.end()) readShown(action); // read already as it streamed, else now
  };

  // An action that opens the chat: its message goes there, sent at once. Inside the click (the
  // browser lets the side panel open only then); where it cannot open, the message waits there.
  // Another press, or the card closed, meanwhile: what it shows is no longer this one's.
  const openChatWith = async (action: WidgetActionInfo, input: string, reads?: Record<string, string>) => {
    const own = (slot.running = new AbortController());
    const reply = await toChat({ action: { id: action.id, input, ...(reads && { reads }) } });
    if (own.signal.aborted) return;
    slot.running = undefined;
    if (reply?.opened) return closePop();
    showPop(action, action.name, el('div', { className: 'muted', textContent: 'Open the side panel: the message is waiting there.' }));
  };

  // What a button does: run at once (the selection, or nothing), or ask for the text first. Not when
  // the page lacks a value the action reads from it.
  const press = (action: WidgetActionInfo) => {
    slot.running?.abort(); // another action's card takes its place
    speaker.drop?.(); // and its boxes that wait are not read
    const reads = readValues(action.reads);
    const missing = Object.entries(reads).filter(([, v]) => !v).map(([name]) => name);
    if (missing.length) return showPop(action, action.name, el('div', { className: 'muted', textContent: `This page does not have what the action reads from it: ${missing.join(', ')}.` }));
    if (action.load) {
      // What it found on load, at once; else what the page says now.
      const found = s.loaded.get(action.id);
      if (found) {
        showPop(action, action.name, outcome(action, found));
        return readShown(action);
      }
      return void run(action, '', reads);
    }
    if (action.input === 'none') return void run(action, '', reads);
    if (action.input === 'selection') {
      if (slot.selection) return void run(action, slot.selection, reads);
      return showPop(action, action.name, el('div', { className: 'muted', textContent: 'Select some text on the page first, then click here.' }));
    }
    if (slot.selection) return void run(action, slot.selection, reads);
    const ask = askField(action, '');
    showPop(action, action.name, ask.row);
    ask.field.focus();
  };

  // The text an action takes, editable in its card: Enter (or Go) runs it again with what it says.
  const askField = (action: WidgetActionInfo, value: string) => {
    const field = el('input', { value, placeholder: action.placeholder ?? '', ariaLabel: action.name });
    const go = el('button', { className: 'run', textContent: 'Go', title: 'Run it with this text' });
    const submit = (e: Event) => {
      if (!e.isTrusted) return;
      if (!field.value.trim()) return field.focus();
      slot.running?.abort();
      void run(action, field.value.trim(), readValues(action.reads));
    };
    go.addEventListener('click', submit);
    field.addEventListener('keydown', (e) => isEnter(e) && submit(e));
    return { row: el('div', { className: 'ask' }, field, go), field };
  };

  return press;
}
