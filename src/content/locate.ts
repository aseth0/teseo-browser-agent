// Where real input (browser.* on the DevTools engine) lands for an element: the center of its first
// visible box, in CSS pixels of the top frame's viewport, as long as the element is what is there.
import { assertEnabled, bringIntoView, fire, holds as holdsElement, selectEditable, setNativeValue, textField } from './actions';
import { describeElement } from './a11y-names';
import { WIDGET_TAG } from '../page/protocol';

// box: the element in document coordinates (a screenshot's clip).
export type Located =
  | { ok: true; x: number; y: number; box: { x: number; y: number; width: number; height: number } }
  | { ok: false; problem: 'no-box' }
  | { ok: false; problem: 'covered'; other: string }
  | { ok: false; problem: 'in-frame' };

// What is at the point, down through open shadow roots (the document only names their host).
function deepestAt(x: number, y: number): Element | null {
  let hit = document.elementFromPoint(x, y);
  while (hit?.shadowRoot && typeof hit.shadowRoot.elementFromPoint === 'function') {
    const inner = hit.shadowRoot.elementFromPoint(x, y);
    if (!inner || inner === hit) break;
    hit = inner;
  }
  return hit;
}

// The focused element, for a key on it (browser.press_key without a ref, on the engine): only in this frame,
// and never in our own floating chat or card (a ba-widget host, whose closed shadow root the page sees as
// the host): keys there would write and send a message as the user.
export type Focused = { ok: true } | { ok: false; problem: 'in-frame' };
export function focused(): Focused {
  const el = document.activeElement;
  return el && (/^(IFRAME|FRAME|OBJECT|EMBED)$/.test(el.tagName) || el.closest(WIDGET_TAG)) ? { ok: false, problem: 'in-frame' } : { ok: true };
}

export function locate(el: Element, opts: { focus?: boolean }): Located {
  assertEnabled(el);
  // The page script runs in the top frame: its viewport is the one the input's coordinates are in.
  if (el.ownerDocument !== document) return { ok: false, problem: 'in-frame' };
  bringIntoView(el);
  const box0 = [...el.getClientRects()].find((r) => r.width > 1 && r.height > 1);
  if (!box0) return { ok: false, problem: 'no-box' };
  const x = box0.left + box0.width / 2;
  const y = box0.top + box0.height / 2;
  const hit = deepestAt(x, y);
  if (!hit || !holdsElement(el, hit)) return { ok: false, problem: 'covered', other: hit ? describeElement(hit) : 'nothing' };
  if (opts.focus && el instanceof HTMLElement) el.focus();
  const box = { x: Math.round(box0.left + window.scrollX), y: Math.round(box0.top + window.scrollY), width: Math.round(box0.width), height: Math.round(box0.height) };
  return { ok: true, x, y, box };
}

// While real input is sent, our own widget (the bubble, the floating chat: ba-widget hosts) lets the
// pointer through, so the input lands on the page under it. Back as it was at inputEnd, or on its own
// after RESTORE_MS (the background gone mid-input). hidden: the tab is not shown (in the background, or
// its window minimized), where real input does not reach.
const RESTORE_MS = 30_000;
const holds = new Map<string, ReturnType<typeof setTimeout>>();
let passed: { host: HTMLElement; value: string; priority: string }[] = [];

export function inputStart(): { token: string; hidden: boolean } {
  if (!holds.size) {
    passed = [...document.querySelectorAll<HTMLElement>(WIDGET_TAG)].map((host) => ({ host, value: host.style.getPropertyValue('pointer-events'), priority: host.style.getPropertyPriority('pointer-events') }));
    for (const { host } of passed) host.style.setProperty('pointer-events', 'none', 'important');
  }
  const token = crypto.randomUUID();
  holds.set(token, setTimeout(() => inputEnd(token), RESTORE_MS));
  return { token, hidden: document.visibilityState === 'hidden' };
}

export function inputEnd(token: string): null {
  const timer = holds.get(token);
  if (timer === undefined) return null;
  clearTimeout(timer);
  holds.delete(token);
  if (holds.size) return null; // another input is still being sent
  for (const { host, value, priority } of passed) {
    if (value) host.style.setProperty('pointer-events', value, priority);
    else host.style.removeProperty('pointer-events');
  }
  passed = [];
  return null;
}

// Where the engine's wheel turns (browser.scroll): the element's center and size, else the viewport's,
// in viewport CSS pixels.
export function wheelAt(target: Element | undefined): { x: number; y: number; width: number; height: number } {
  if (!target) return { x: window.innerWidth / 2, y: window.innerHeight / 2, width: window.innerWidth, height: window.innerHeight };
  const r = target.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, width: r.width, height: r.height };
}

// The engine's browser.type replaces a field's value, as the synthetic one does (unless clear=false): an
// input or a textarea is emptied, an editable element's contents only selected, and real input then types
// over them. 'selected': with no text to type, they are still there to delete. This and caretAtEnd focus the
// field themselves, in one go with its selection (selectEditable): the locate before them must not.
export function clearField(el: Element): 'emptied' | 'selected' {
  assertEnabled(el);
  const field = textField(el);
  if (field.kind === 'editable') {
    selectEditable(field.el, 'all');
    return 'selected';
  }
  field.el.focus();
  setNativeValue(field.el, '');
  fire(el, 'input', { inputType: 'deleteContentBackward' });
  return 'emptied';
}

// browser.type with clear=false adds to the value: a field just focused has its caret at the start.
export function caretAtEnd(el: Element): void {
  assertEnabled(el);
  const field = textField(el);
  if (field.kind === 'editable') return selectEditable(field.el, 'end');
  field.el.focus();
  // Some input types (email, number) have no caret to set: selectionStart is null.
  if (field.el.selectionStart !== null) field.el.setSelectionRange(field.el.value.length, field.el.value.length);
}

// Where to press for the page to get the browser's real focus, before real input: el.focus() moves the
// focus inside the page, not into it from the browser's own UI (a side panel). null when the page has it,
// or the element, or else the page's focused one, is no text field, where a press could do something of
// its own. Read before focus emulation is on, which makes hasFocus true.
export function focusSpot(target: Element | undefined): { x: number; y: number } | null {
  if (document.hasFocus()) return null;
  const el = target ?? document.activeElement;
  if (!el) return null;
  try {
    textField(el);
  } catch {
    return null;
  }
  const at = locate(el, {});
  return at.ok ? { x: at.x, y: at.y } : null;
}

// What a field holds, to tell whether real input reached it: without what its editor shows but does not
// hold (a placeholder).
export function fieldText(el: Element): string {
  const field = textField(el);
  if (field.kind === 'input') return field.el.value;
  const copy = field.el.cloneNode(true) as HTMLElement;
  for (const shown of copy.querySelectorAll('[contenteditable="false"]')) shown.remove();
  return copy.textContent ?? '';
}

// Real key presses the page has seen since the first call, to tell whether real input reached it.
let keysSeen: number | undefined;
export function keysSeenCount(): number {
  if (keysSeen === undefined) {
    keysSeen = 0;
    window.addEventListener('keydown', (e) => void (e.isTrusted && keysSeen!++), true);
  }
  return keysSeen;
}
