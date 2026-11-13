// Whether a click changed what the page shows, for browser.click's reply to say when it did not: its
// address, its DOM (also in open shadow roots and same-origin frames, not in our own widget, nor a
// tabindex moved along as the focus goes, nor what hovering or focusing the element clicked shows: a
// tooltip, its look before the click event), the focus moved elsewhere than the element clicked (or what
// holds it, or what it holds), the state of the control clicked. Watched from right before the press
// until the page has settled after it; the background adds a tab opened from it.
import { WIDGET_TAG } from '../page/protocol';
import { ANY_CHANGE } from './actions';
import { walkDeep } from './dom-find';
import { frameDocument } from './dom-tree';

// Clicks whose effect the page does not show: a native picker or a file chooser opens, a download
// starts, a drawing or a player changes inside. Not watched: the reply says nothing either way.
const UNSEEN = 'select, option, input[type=file], a[download], canvas, video, audio, embed, object';
const MOST_MS = 30_000; // a watch never read is dropped after this
const TOOLTIP = '[role=tooltip]';
// What points to a tooltip; on the element clicked or what holds it, never a real effect.
const POINTERS = ['aria-describedby', 'aria-labelledby'];
const POINTING = POINTERS.map((a) => `[${a}]`).join();
// The attributes that show an element hovered or focused, when the click event is not what changed them;
// aria-expanded and the like are real effects.
const LOOK = /^(class|style|data-.*)$/;
// What makes a layer more than a tooltip's, if it is not inside the tooltip; an arrow may be drawn.
const CONTENT = 'a[href], button, input, select, textarea, img, video, [role]:not([role=presentation], [role=none]), [tabindex], [contenteditable]';

interface Watch {
  url: string;
  focus: Element | null;
  state: string;
  el: Element;
  pointed: Set<string>; // the ids it points to outside itself, seen so far
  shown: WeakSet<Node>; // the tooltips and their layers added since the watch began
  clicked: boolean; // the click event has fired: what the page does from then on is the click's
  onClick: () => void;
  observers: Map<Node, MutationObserver>; // by the root each is on
  changed: boolean;
  timer: ReturnType<typeof setTimeout>;
}
const watches = new Map<string, Watch>();

// A checkbox's or a field's state, which a click changes without a mutation (a label's control's).
function stateOf(el: Element): string {
  const control = el.tagName === 'LABEL' ? (el as HTMLLabelElement).control : el;
  return control?.tagName === 'INPUT' ? `${(control as HTMLInputElement).checked} ${(control as HTMLInputElement).value}` : '';
}

const elementOf = (n: Node) => (n.nodeType === Node.ELEMENT_NODE ? (n as Element) : n.parentElement);
const inWidget = (n: Node) => !!elementOf(n)?.closest(WIDGET_TAG);
// The element and what holds it, across the edge of a shadow root.
function withHolders(el: Element): Element[] {
  const chain = [];
  for (let e: Element | null = el; e; e = e.parentElement ?? (e.getRootNode() as ShadowRoot).host ?? null) chain.push(e);
  return chain;
}
const holds = (holder: Element, el: Element) => withHolders(el).includes(holder);
function focusIn(doc: Document): Element | null {
  let focus = doc.activeElement;
  while (focus?.shadowRoot?.activeElement) focus = focus.shadowRoot.activeElement;
  return focus;
}

// What the element, what holds it and what it holds point to. Not what the one pointing holds: its own
// label, or the heading of its section, is part of its content.
function notePointed(watch: Watch) {
  for (const h of [...watch.el.querySelectorAll(POINTING), ...withHolders(watch.el)]) {
    for (const id of POINTERS.flatMap((a) => h.getAttribute(a)?.split(/\s+/) ?? [])) {
      // No such call once the click has removed it from the page.
      const node = (h.getRootNode() as Partial<Document>).getElementById?.(id);
      if (node && !h.contains(node)) watch.pointed.add(id);
    }
  }
}

const isTip = (el: Element, pointed: Set<string>) => el.matches(TOOLTIP) || pointed.has(el.id);
// Inside a tooltip, or what was added as one: what is pointed to from before may be content (a status).
function inTip(n: Node, shown: WeakSet<Node>): boolean {
  for (let e = elementOf(n); e; e = e.parentElement) if (e.matches(TOOLTIP) || shown.has(e)) return true;
  return false;
}
// A tooltip, or a layer that holds nothing else: the tooltip's text aside (it may show as text, with a
// copy hidden for screen readers), no text and no control or picture.
function onlyTip(el: Element, pointed: Set<string>): boolean {
  if (isTip(el, pointed)) return true;
  const tips = [...el.querySelectorAll(`${TOOLTIP}, [id]`)].filter((e) => isTip(e, pointed));
  const outside = (e: Element) => !tips.some((t) => t.contains(e));
  if (!tips.length || [...el.querySelectorAll(CONTENT)].some(outside)) return false;
  const rest = tips.reduce((text, t) => text.replaceAll(t.textContent?.trim() ?? '', ''), el.textContent ?? '');
  return !rest.trim();
}
// A framework's comment, the white space between elements.
const showsNothing = (n: Node) => n.nodeType === Node.COMMENT_NODE || (n.nodeType === Node.TEXT_NODE && !n.textContent?.trim());

// Whether adding or removing this counts; a tooltip is noted, for what later changes inside it.
function nodeCounts(n: Node, watch: Watch): boolean {
  if (inWidget(n) || showsNothing(n)) return false;
  if (n.nodeType !== Node.ELEMENT_NODE || !onlyTip(n as Element, watch.pointed)) return true;
  watch.shown.add(n);
  return false;
}

function counts(r: MutationRecord, watch: Watch): boolean {
  if (inWidget(r.target) || inTip(r.target, watch.shown)) return false;
  if (r.type === 'childList') return [...r.addedNodes, ...r.removedNodes].some((n) => nodeCounts(n, watch));
  if (r.type === 'characterData') return true;
  const name = r.attributeName ?? '';
  if (name === 'tabindex') return false;
  const target = r.target as Element;
  if (!holds(target, watch.el) && !holds(watch.el, target)) return true;
  return !POINTERS.includes(name) && (watch.clicked || !LOOK.test(name));
}

function seen(watch: Watch, records: MutationRecord[]) {
  if (watch.changed || !records.length) return;
  notePointed(watch);
  if (records.some((r) => counts(r, watch))) watch.changed = true;
}

function observe(watch: Watch, root: Node) {
  const observer = new MutationObserver((records) => seen(watch, records));
  observer.observe(root, ANY_CHANGE);
  watch.observers.set(root, observer);
}

// A shadow root attached, or a frame's document loaded, since the watch began: no observer told of it, nor
// of what was put in it before now, so it counts by what it holds.
function rootAdded(watch: Watch, root: Node) {
  if (!watch.changed && [...root.childNodes].some((n) => nodeCounts(n, watch))) watch.changed = true;
  observe(watch, root);
}

// What the observers have not told yet, and the roots none is on.
function flush(watch: Watch) {
  for (const observer of watch.observers.values()) seen(watch, observer.takeRecords());
  for (const root of roots(document)) if (!watch.observers.has(root)) rootAdded(watch, root);
}

// What the page does from the click event on is the click's (its handlers may answer a request first), what
// it did before is hovering and focusing.
function clickStarts(watch: Watch) {
  flush(watch);
  watch.clicked = true;
}

// What the click is watched in: the page, its same-origin frames and the open shadow roots there are now.
function roots(doc: Document): Node[] {
  const found: Node[] = [doc];
  walkDeep(doc.documentElement, (el) => {
    if (el.shadowRoot) found.push(el.shadowRoot);
    const inner = frameDocument(el);
    if (inner) found.push(inner);
  });
  return found;
}

// A watch on the page for a click on `el`, to read with endChange; null for a click whose effect the
// page does not show.
export function startChange(el: Element): string | null {
  if (el.closest(UNSEEN)) return null;
  const token = crypto.randomUUID();
  const watch: Watch = {
    url: location.href,
    focus: focusIn(el.ownerDocument),
    state: stateOf(el),
    el,
    pointed: new Set(),
    shown: new WeakSet(),
    clicked: false,
    onClick: () => clickStarts(watch),
    observers: new Map(),
    changed: false,
    timer: setTimeout(() => endChange(token), MOST_MS),
  };
  notePointed(watch);
  el.ownerDocument.defaultView?.addEventListener('click', watch.onClick, true);
  for (const root of roots(document)) observe(watch, root);
  watches.set(token, watch);
  return token;
}

// Whether the page changed since startChange; true for a watch it no longer has (dropped, or the page
// was replaced): nothing is said then.
export function endChange(token: string): boolean {
  const watch = watches.get(token);
  if (!watch) return true;
  watches.delete(token);
  clearTimeout(watch.timer);
  watch.el.ownerDocument.defaultView?.removeEventListener('click', watch.onClick, true);
  flush(watch);
  for (const observer of watch.observers.values()) observer.disconnect();
  const focus = focusIn(watch.el.ownerDocument);
  const focusMoved = focus !== watch.focus && !!focus && focus !== watch.el.ownerDocument.body && !holds(focus, watch.el) && !holds(watch.el, focus);
  return watch.changed || location.href !== watch.url || focusMoved || stateOf(watch.el) !== watch.state || !watch.el.isConnected;
}
