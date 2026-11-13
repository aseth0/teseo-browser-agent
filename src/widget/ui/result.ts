// What an action's card shows once it has run: its boxes, each with its Copy (and, a box of text, its
// speaker: widget/ui/box-speak), and the chat's answer to go on with.
import type { WidgetRunReply } from '../protocol';
import { boxText } from './box-text';
import { el, markdown, safeHref, trustedButton } from './dom';
import type { FloatingChat } from './floating-chat';
import type { BoxSpeaker } from './box-speak';

const COPIED_MS = 1500; // a Copy shows it copied this long

// `scratch`: where a copy without the clipboard API puts the field it copies from. `folded`: the
// headings folded in the answer as it streamed, for the box that is that answer. `speak`: the action's
// id and the speakers of its boxes.
export function result(reply: WidgetRunReply | undefined, toChat: FloatingChat['toChat'], scratch: () => HTMLElement, folded?: Set<number>, speak?: { actionId: string; speaker: BoxSpeaker }): Node {
  if (!reply) return el('div', { className: 'error', textContent: 'No answer from the extension: it may have been reloaded. Reload the page.' });
  if ('error' in reply) return el('div', { className: 'error', textContent: reply.error });
  if (reply.outputs.every((o) => !o.lines.length && !o.text)) return el('div', { className: 'muted', textContent: 'Nothing found.' });
  const boxes = el('div', { className: 'boxes' }, ...reply.outputs.map((o, i) => {
    const note = el('div'); // why it was not read aloud
    // A box of text is read aloud; a list of lines (links, mostly) is not.
    const speaker = !o.lines.length && o.text ? speak?.speaker(speak.actionId, i, o.label, o.text, note) : undefined;
    return el('section', { className: 'box' },
      el('div', { className: 'box-head' }, el('span', { className: 'box-label', textContent: o.label }), ...(speaker ? [speaker] : []), copyButton(o.label, boxText(o), scratch)),
      o.lines.length
        ? el('ul', {}, ...o.lines.map((line) => el('li', {}, safeHref(line.href) ? el('a', { href: line.href, target: '_blank', rel: 'noopener noreferrer', textContent: line.text }) : line.text)))
        : o.tree ? markdown(o.tree, reply.outputs.length === 1 ? folded : undefined) : o.text ? el('div', { className: 'text', textContent: o.text }) : el('div', { className: 'muted', textContent: 'Nothing.' }),
      note);
  }));
  if (!reply.chat) return boxes;
  return el('div', { className: 'answer' }, boxes, reply.chatIcons ? chatIcons(reply.chat, toChat) : chatButton(reply.chat, toChat));
}

// The chat's buttons as icons: go on in the chat floating here, or in the side panel.
function chatIcons(chat: string, toChat: FloatingChat['toChat']) {
  const row = el('div', { className: 'chat-icons' });
  const icon = (textContent: string, title: string, where: 'here' | 'panel') =>
    trustedButton({ className: 'icon chat-icon', textContent, title, ariaLabel: title }, () => void goOn(chat, toChat, row, where));
  row.append(icon('💬', 'Go on in the chat, here', 'here'), icon('◨', 'Go on in the side panel', 'panel'));
  return row;
}

// Goes on with the model's answer in the side panel (or in the chat floating here); where the
// browser does not let the click open it, the answer waits there for the user to open it.
function chatButton(chat: string, toChat: FloatingChat['toChat']) {
  const button: HTMLButtonElement = trustedButton({ className: 'chat', textContent: 'Open in the chat' }, () => void goOn(chat, toChat, button));
  return button;
}

// The conversation handed to the chat (`where`: none, where the chat is); where the side panel could
// not open, `shown` gives way to a note that it waits there.
async function goOn(chat: string, toChat: FloatingChat['toChat'], shown: HTMLElement, where?: 'here' | 'panel') {
  const reply = await toChat({ chat }, where);
  if (!reply?.opened) shown.replaceWith(el('div', { className: 'muted', textContent: 'Open the side panel: the conversation is waiting there.' }));
}

// A box's Copy: its Markdown in the clipboard; a page without the clipboard API (not https) copies
// through a selected field.
function copyButton(label: string, text: string, scratch: () => HTMLElement) {
  const b: HTMLButtonElement = trustedButton({ className: 'icon copy', textContent: '⧉', title: `Copy ${label}`, ariaLabel: `Copy ${label}` }, () =>
    void copy(text, scratch()).then((ok) => {
      b.textContent = ok ? '✓' : '✕';
      setTimeout(() => (b.textContent = '⧉'), COPIED_MS);
    }));
  b.hidden = !text;
  return b;
}

async function copy(text: string, scratch: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const field = el('textarea', { value: text });
    scratch.append(field);
    field.select();
    const ok = document.execCommand('copy');
    field.remove();
    return ok;
  }
}
