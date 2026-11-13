// DOM actions on elements resolved from refs. Events are synthetic (isTrusted=false), which works for
// most sites, including React/Vue controlled inputs; a page that checks isTrusted needs real input
// (Settings → Chromium DevTools).
import { collapseSpaces, fold } from '../core/util';
import { describeElement, isDisabled } from './a11y-names';
import { KEYS } from '../tools/browser/keys';
import { WIDGET_TAG } from '../page/protocol';
import { hitTargetParents, inputFillValue, kInputTypesToSetValue } from '../vendor/playwright/actionUtils';
import { parentElementOrShadowHost } from '../vendor/playwright/domUtils';

function view(el: Element): Window & typeof globalThis {
  return el.ownerDocument.defaultView as Window & typeof globalThis;
}

function centerOf(el: Element): { clientX: number; clientY: number } {
  const r = el.getBoundingClientRect();
  return { clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 };
}

type EventCtor = new (type: string, init?: Record<string, unknown>) => Event;

function eventClass(w: Window & typeof globalThis, type: string): EventCtor {
  if (type.startsWith('pointer')) return (w.PointerEvent) ?? w.MouseEvent; // jsdom lacks PointerEvent
  if (type.startsWith('key')) return w.KeyboardEvent;
  if (type.startsWith('mouse') || type === 'click') return w.MouseEvent;
  if (type === 'beforeinput') return w.InputEvent;
  return w.Event;
}

// Dispatches a bubbling, cancelable event; returns false if a listener called preventDefault().
export function fire(el: Element, type: string, init: Record<string, unknown> = {}) {
  const Ctor = eventClass(view(el), type);
  return el.dispatchEvent(new Ctor(type, { bubbles: true, cancelable: true, composed: true, ...init }));
}

// The element scrolled to the middle at once. A page that scrolls smoothly (scroll-behavior: smooth) would
// still be on the way when the element is measured, and real input would land where it was.
export function bringIntoView(el: Element, opts: { inline?: boolean } = {}) {
  el.scrollIntoView?.({ block: 'center', ...(opts.inline !== false && { inline: 'center' }), behavior: 'instant' as ScrollBehavior });
}

export function assertEnabled(el: Element) {
  if (isDisabled(el)) throw new Error('The element is disabled');
}

// What a real mouse's pointer events carry: a PointerEvent's own defaults are pointerType "" and isPrimary false.
const MOUSE = { pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0 };

// What else is on top of the element at its center, the way Playwright's hit-target check finds it: the
// outermost part of it that does not hold the element (a dialog, a banner). None when the element, what it
// holds or what holds it is there (a click there reaches it too), its label, our own widget, or a center out
// of the viewport (nothing to test there).
function coveredBy(el: Element, at: { clientX: number; clientY: number }): string | undefined {
  const w = view(el);
  if (typeof el.ownerDocument.elementsFromPoint !== 'function') return undefined; // jsdom
  if (at.clientX < 0 || at.clientY < 0 || at.clientX >= w.innerWidth || at.clientY >= w.innerHeight) return undefined;
  const hit = hitTargetParents({ x: at.clientX, y: at.clientY }, el);
  const top = hit[0];
  if (!top || top.closest(WIDGET_TAG) || top.closest('label')?.control === el) return undefined;
  const over = hit.filter((h) => !holds(h, el));
  return over.length ? describeElement(over.at(-1)!) : undefined;
}

// Whether `holder` is `el` or holds it, across the edges of shadow roots: as the page is drawn, a slotted
// element is held by its slot.
export function holds(holder: Element, el: Element): boolean {
  for (let e: Element | undefined = el; e; e = e.assignedSlot ?? parentElementOrShadowHost(e)) if (e === holder) return true;
  return false;
}

// Where a press moves the focus, as the browser's does: to the element or the nearest one holding it that
// takes focus (across shadow roots); with none, away from the one that had it.
function focusOnPress(el: Element): void {
  const w = view(el);
  for (let e: Element | undefined = el; e; e = parentElementOrShadowHost(e)) {
    const focusable = (e instanceof w.HTMLElement || e instanceof w.SVGElement) && (e.tabIndex >= 0 || e.hasAttribute('tabindex') || (e as HTMLElement).isContentEditable);
    if (focusable && !isDisabled(e)) return (e as HTMLElement).focus();
  }
  const active = el.ownerDocument.activeElement;
  if (active instanceof w.HTMLElement && active !== el.ownerDocument.body) active.blur();
}

// A real click's events: the pointer comes over the element, presses and lets go. As in the browser, a
// pointerdown canceled keeps mousedown and mouseup from being sent (the click still is), and a mousedown
// canceled keeps the focus where it was. `covered`: what is on top of it, where a real click would land.
export function click(el: Element): { covered?: string } {
  assertEnabled(el);
  bringIntoView(el);
  const at = { ...centerOf(el), ...MOUSE };
  const covered = coveredBy(el, at);
  for (const type of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove'])
    fire(el, type, { ...at, buttons: 0, ...(type.endsWith('enter') && { bubbles: false }) });
  const pointerDown = fire(el, 'pointerdown', { ...at, buttons: 1 });
  if (pointerDown && fire(el, 'mousedown', { ...at, buttons: 1, detail: 1 })) focusOnPress(el);
  fire(el, 'pointerup', { ...at, buttons: 0 });
  if (pointerDown) fire(el, 'mouseup', { ...at, buttons: 0, detail: 1 });
  if (el instanceof view(el).HTMLElement) el.click();
  else fire(el, 'click', { ...at, detail: 1 });
  return covered ? { covered } : {};
}

// Sets the value through the prototype's native setter so frameworks that track the
// value (React) notice the change, then fires input/change like a real edit would.
export function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto = Object.getPrototypeOf(el) as object;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

// Every change in a subtree, for the MutationObservers that wait for a page to settle or change.
export const ANY_CHANGE: MutationObserverInit = { subtree: true, childList: true, attributes: true, characterData: true };

const SUBMIT_QUIET_MS = 100;
const SUBMIT_MOST_MS = 1000;
const SELECTED_QUIET_MS = 150; // above the 100 ms Slate takes to read a selection after the last one
const SELECTED_MOST_MS = 500;

// The field an element is to type into: an input or a textarea (not read-only), or an editable
// element; throws when it is neither.
export function textField(el: Element): { kind: 'input'; el: HTMLInputElement | HTMLTextAreaElement } | { kind: 'editable'; el: HTMLElement } {
  const w = view(el);
  if (el instanceof w.HTMLInputElement || el instanceof w.HTMLTextAreaElement) {
    if (el.readOnly) throw new Error('The field is read-only');
    return { kind: 'input', el };
  }
  if ((el as HTMLElement).isContentEditable || el.getAttribute('contenteditable') !== null) return { kind: 'editable', el: el as HTMLElement };
  throw new Error('The element is not a text field');
}

// An editable element's contents selected, or the caret after them: an editor that keeps its own model
// (Slate, ProseMirror, Lexical) follows the selection. Its nodes are its own: with them taken away it loses
// track of its text, and sends nothing, or the old text, on Enter. Focused here, in one go: Slate takes in
// the caret a separate focus puts, and draws it back over a selection made after.
export function selectEditable(el: HTMLElement, to: 'all' | 'end'): void {
  el.focus();
  const selection = el.ownerDocument.getSelection();
  selection?.selectAllChildren(el);
  if (to === 'end') selection?.collapseToEnd();
}

// One edit over the selection: the text put in its place, or with no text, the selection deleted.
// execCommand tells an editor nothing before it edits: an editor that takes its input from beforeinput
// (Slate, Lexical) gets it here, cancels it and makes the edit itself. Any other is left to execCommand,
// which keeps its undo stack and its listeners in sync where supported (ProseMirror reads the DOM's change).
function editSelection(el: HTMLElement, text: string, replace: boolean): void {
  const inputType = text ? 'insertText' : 'deleteContentBackward';
  if (!fire(el, 'beforeinput', { inputType, data: text || null })) return;
  const doc = el.ownerDocument;
  const edited = typeof doc.execCommand === 'function' && (text ? doc.execCommand('insertText', false, text) : doc.execCommand('delete'));
  if (edited) return; // and it told the page with an input event of its own
  el.textContent = replace ? text : (el.textContent ?? '') + text;
  fire(el, 'input');
}

// The format each input type that is not typed into takes, for the error when a value is not in it.
const FORMATS: Record<string, string> = { color: '#rrggbb', date: 'yyyy-mm-dd', time: 'hh:mm', 'datetime-local': 'yyyy-mm-ddThh:mm', month: 'yyyy-mm', week: 'yyyy-Www' };
const formatOf = (input: HTMLInputElement) =>
  input.type === 'range' ? `a number from ${input.min || 0} to ${input.max || 100}${input.step && input.step !== 'any' ? ` in steps of ${input.step}` : ''}` : FORMATS[input.type];
// Input types a click works, not typing.
const CLICKED = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'image', 'file']);

// The value an input is given, checked as Playwright's fill does: an input that takes none (a checkbox), a
// number that is not one, or a date, time, color or range the input would empty (not in its format) is an error.
function inputValue(input: HTMLInputElement | HTMLTextAreaElement, value: string): string {
  if (!(input instanceof view(input).HTMLInputElement)) return value;
  const type = input.type;
  const fill = inputFillValue(input, value);
  if ('error' in fill) throw new Error(CLICKED.has(type) ? `An input of type "${type}" takes no text: click it instead` : fill.error);
  if (!kInputTypesToSetValue.has(type)) return fill.value;
  const before = input.value;
  setNativeValue(input, fill.value);
  const taken = input.value === fill.value;
  setNativeValue(input, before);
  if (!taken) throw new Error(`Not typed: an input of type "${type}" takes ${formatOf(input) ?? 'another format'}, not "${fill.value}"`);
  return fill.value;
}

// submit: Enter once the page has taken the text in. An editor that keeps its own state (ProseMirror,
// a framework's) updates it after the input event, and sends nothing on an Enter that comes before.
export async function typeText(el: Element, text: string, opts: { clear?: boolean; submit?: boolean } = {}): Promise<void> {
  assertEnabled(el);
  bringIntoView(el, { inline: false });
  const field = textField(el);
  if (field.kind === 'input') {
    const input = field.el;
    const value = inputValue(input, (opts.clear ?? true) ? text : input.value + text);
    input.focus();
    setNativeValue(input, value);
    fire(input, 'input', { inputType: 'insertText', data: text });
    fire(input, 'change');
  } else {
    const replace = opts.clear ?? true;
    selectEditable(field.el, replace ? 'all' : 'end');
    if (text || replace) {
      // A selectionchange comes in a task of its own, and an editor edits over the selection it took in
      // from one (real input brings its range along).
      await waitForSettle(el.ownerDocument, SELECTED_QUIET_MS, SELECTED_MOST_MS);
      editSelection(field.el, text, replace);
    }
  }
  if (!opts.submit) return;
  await waitForSettle(el.ownerDocument, SUBMIT_QUIET_MS, SUBMIT_MOST_MS);
  pressKey(el, 'Enter');
}

export function selectOption(el: Element, value: string): string {
  assertEnabled(el);
  if (!(el instanceof view(el).HTMLSelectElement)) throw new Error('The element is not a <select>; click it and then click the option instead');
  const wanted = fold(collapseSpaces(value));
  const option = [...el.options].find((o) => o.value === value || fold(collapseSpaces(o.textContent)) === wanted);
  if (!option) throw new Error(`No option "${value}". Options: ${[...el.options].map((o) => collapseSpaces(o.textContent)).join(', ')}`);
  if (isDisabled(option)) throw new Error(`The option "${collapseSpaces(option.textContent)}" is disabled`);
  el.focus();
  el.value = option.value;
  fire(el, 'input');
  fire(el, 'change');
  return collapseSpaces(option.textContent);
}

// What a real key carries: key, code and the legacy keyCode/which that many pages still read. A key named
// in tools/browser/keys, or one character ("Space" and " " are the space bar).
function keyFields(name: string): { key: string; code: string; keyCode: number; typed?: string } {
  if (name === 'Space' || name === ' ') return { key: ' ', code: 'Space', keyCode: 32, typed: ' ' };
  if (Object.hasOwn(KEYS, name)) return { key: name, code: KEYS[name]!.code, keyCode: KEYS[name]!.vk, ...(name === 'Enter' && { typed: '\r' }) };
  if ([...name].length !== 1) return { key: name, code: name, keyCode: 0 };
  const upper = name.toUpperCase();
  if (/^[A-Z]$/.test(upper)) return { key: name, code: `Key${upper}`, keyCode: upper.charCodeAt(0), typed: name };
  if (/^[0-9]$/.test(name)) return { key: name, code: `Digit${name}`, keyCode: name.charCodeAt(0), typed: name };
  return { key: name, code: '', keyCode: 0, typed: name };
}

// A keyboard event with keyCode/which/charCode set, as the constructor leaves them 0.
function fireKey(el: Element, type: 'keydown' | 'keypress' | 'keyup', f: ReturnType<typeof keyFields>): boolean {
  const event = new (view(el).KeyboardEvent)(type, { key: f.key, code: f.code, bubbles: true, cancelable: true, composed: true });
  const code = type === 'keypress' ? (f.typed ?? '').charCodeAt(0) || 0 : f.keyCode;
  for (const prop of ['keyCode', 'which']) Object.defineProperty(event, prop, { get: () => code });
  Object.defineProperty(event, 'charCode', { get: () => (type === 'keypress' ? code : 0) });
  return el.dispatchEvent(event);
}

const isRole = (el: Element, ...roles: string[]) => roles.includes(el.getAttribute('role') ?? '');

// What the browser does for a key it was not stopped from doing (synthetic keys get none of it).
function keyDefault(el: Element, key: string, on: 'down' | 'up'): void {
  const w = view(el);
  if (!(el instanceof w.HTMLElement) || isDisabled(el)) return;
  if (on === 'down' && key === 'Enter') {
    if (el instanceof w.HTMLInputElement) {
      if (el.form && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type)) el.form.requestSubmit();
      else if (['button', 'submit', 'reset'].includes(el.type)) el.click();
    } else if (el instanceof w.HTMLButtonElement || (el instanceof w.HTMLAnchorElement && el.hasAttribute('href')) || isRole(el, 'button', 'link', 'menuitem', 'tab', 'option')) {
      el.click();
    }
    return;
  }
  if (on === 'up' && key === ' ') {
    const toggles = el instanceof w.HTMLInputElement && ['checkbox', 'radio', 'button', 'submit', 'reset'].includes(el.type);
    if (toggles || el instanceof w.HTMLButtonElement || isRole(el, 'button', 'checkbox', 'switch', 'menuitem', 'tab', 'option', 'radio')) el.click();
    return;
  }
  if (on !== 'down') return;
  if (el instanceof w.HTMLSelectElement && !el.multiple) {
    const last = el.options.length - 1;
    const i = el.selectedIndex;
    const to = { ArrowDown: Math.min(last, i + 1), ArrowRight: Math.min(last, i + 1), ArrowUp: Math.max(0, i - 1), ArrowLeft: Math.max(0, i - 1), Home: 0, End: last }[key];
    if (to !== undefined && to !== i && last >= 0) {
      el.selectedIndex = to;
      fire(el, 'input');
      fire(el, 'change');
    }
    return;
  }
  if (key === 'Tab') nextFocusable(el)?.focus();
}

const FOCUSABLE = 'a[href], button, input:not([type="hidden"]), select, textarea, [contenteditable=""], [contenteditable="true"], [tabindex]';
// The element Tab goes to after `el`, in the document's order (positive tabindex orders not followed).
function nextFocusable(el: Element): HTMLElement | undefined {
  const w = view(el);
  const all = [...el.ownerDocument.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (c) => c.tabIndex >= 0 && !isDisabled(c) && !c.closest('[hidden], [inert]') && w.getComputedStyle(c).visibility !== 'hidden' && w.getComputedStyle(c).display !== 'none',
  );
  return all.find((c) => el.compareDocumentPosition(c) & w.Node.DOCUMENT_POSITION_FOLLOWING && !el.contains(c));
}

// Synthetic keys reach the page's listeners with what a real key carries (keyCode too), on the element
// focused first; the browser's own part (a button pressed, a form sent, a <select> moved, Tab) is done
// here unless a listener cancels it. Typing a character is not: browser.type does that.
export function pressKey(el: Element, key: string): void {
  const f = keyFields(key);
  const w = view(el);
  if (el instanceof w.HTMLElement && el.ownerDocument.activeElement !== el) el.focus();
  const proceed = fireKey(el, 'keydown', f);
  if (proceed && f.typed !== undefined) fireKey(el, 'keypress', f);
  if (proceed) keyDefault(el, f.key, 'down');
  // keyup goes where the focus is then: after Tab, the next element.
  const focused = el.ownerDocument.activeElement;
  const up = f.key === 'Tab' && focused && focused !== el.ownerDocument.body ? focused : el;
  if (fireKey(up, 'keyup', f) && proceed) keyDefault(el, f.key, 'up');
}

export function scroll(target: Element | Window, direction: 'up' | 'down' | 'left' | 'right'): void {
  const isWindow = !('nodeType' in target);
  const w = isWindow ? (target) : view(target);
  const box = isWindow ? { width: w.innerWidth, height: w.innerHeight } : (target).getBoundingClientRect();
  const dy = direction === 'down' ? box.height * 0.8 : direction === 'up' ? -box.height * 0.8 : 0;
  const dx = direction === 'right' ? box.width * 0.8 : direction === 'left' ? -box.width * 0.8 : 0;
  target.scrollBy({ left: dx, top: dy, behavior: 'instant' as ScrollBehavior });
}

// Resolves once the DOM has been quiet for quietMs (or after maxMs).
export function waitForSettle(doc: Document, quietMs = 300, maxMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    const w = doc.defaultView!;
    let timer = w.setTimeout(done, quietMs);
    const hard = w.setTimeout(done, maxMs);
    const obs = new w.MutationObserver(() => {
      w.clearTimeout(timer);
      timer = w.setTimeout(done, quietMs);
    });
    obs.observe(doc, ANY_CHANGE);
    function done() {
      obs.disconnect();
      w.clearTimeout(timer);
      w.clearTimeout(hard);
      resolve();
    }
  });
}
