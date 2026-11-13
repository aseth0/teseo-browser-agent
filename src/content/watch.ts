// A watch in the page (browser.watch): runs on its own until an element is gone or appears
// (matched like browser.find, or by a CSS selector) and/or the page stops changing, then calls
// back once. Nobody waits on it: the background is told by a message (WATCH_FIRED).
//
// Hidden tabs slow their timers down (to once a minute after a while), but not the
// MutationObserver: the conditions are checked from its callback, at most every CHECK_MS, and a
// timer is only the trailing check after the last change. The element matched for `gone` or `appears`
// is kept, and while it is still on the page, shown and matching nothing more is looked up; only once
// it goes is the page searched again (browser.find reads the whole accessibility tree).
import { type RefStore, type Tracked, tracker } from './a11y';
import { ANY_CHANGE } from './actions';

const CHECK_MS = 1000;

export interface WatchSpec {
  gone?: string;
  appears?: string;
  css?: boolean; // gone/appears are CSS selectors, not browser.find queries
  stableMs?: number; // and the page has not changed for this long
}

// A condition waited for, as the page reports it: the background says it in words (the model's texts,
// watches/conditions), never the page.
export type Condition = { kind: 'gone' | 'appears'; query: string } | { kind: 'stable'; ms: number };

export interface WatchFired {
  ms: number;
  met: Condition[];
}

export function startWatch(doc: Document, refs: RefStore, spec: WatchSpec, onFire: (fired: WatchFired) => void): () => void {
  const w = doc.defaultView!;
  const start = Date.now();
  let lastChange = start;
  let lastCheck = 0;
  let dirty = true;
  let anchor: Element | undefined; // the element `gone` waits on, by CSS
  let trailing: number | undefined;
  let stopped = false;

  const shown = (el: Element) => el.isConnected && el.getClientRects().length > 0;
  // By browser.find: the element found is kept and read again; the page is searched again only once it
  // is not there, and not at every check (tracker).
  const goneFound = spec.gone && !spec.css ? tracker(doc, refs, spec.gone, CHECK_MS) : undefined;
  const appearsFound = spec.appears && !spec.css ? tracker(doc, refs, spec.appears, CHECK_MS) : undefined;
  let retryIn: number | undefined; // a search still due
  const found = (t: () => Tracked) => {
    const r = t();
    if (r.retryIn !== undefined) retryIn = Math.min(retryIn ?? Infinity, r.retryIn);
    return r;
  };
  const appeared = (q: string) => (spec.css ? !!doc.querySelector(q) : found(appearsFound!).found);
  // By CSS: found again only once the element kept is gone.
  const isGone = (): boolean => {
    if (spec.css) {
      if (anchor && shown(anchor)) return false;
      return !(anchor = doc.querySelector(spec.gone!) ?? undefined);
    }
    const r = found(goneFound!);
    return !r.found && !r.truncated; // not found in a search that was cut is not gone
  };

  // The element conditions are read again only after a change (or when a search was still due); the
  // page staying unchanged is not a reason to search it again.
  let elements: [boolean, Condition][] = [];
  const conditions = (): [boolean, Condition][] => {
    if (dirty) {
      dirty = false;
      retryIn = undefined;
      elements = [];
      if (spec.gone) elements.push([isGone(), { kind: 'gone', query: spec.gone }]);
      if (spec.appears) elements.push([appeared(spec.appears), { kind: 'appears', query: spec.appears }]);
      if (retryIn !== undefined) dirty = true;
    }
    const all = [...elements];
    if (spec.stableMs !== undefined) all.push([Date.now() - lastChange >= spec.stableMs, { kind: 'stable', ms: spec.stableMs }]);
    return all;
  };

  const check = () => {
    if (stopped) return;
    w.clearTimeout(trailing);
    trailing = undefined;
    lastCheck = Date.now();
    if (!dirty && spec.stableMs === undefined) return;
    const all = conditions();
    if (!all.every(([ok]) => ok)) {
      if (retryIn !== undefined) later(retryIn);
      if (spec.stableMs !== undefined) later(spec.stableMs - (Date.now() - lastChange));
      return;
    }
    stop();
    onFire({ ms: Date.now() - start, met: all.map(([, c]) => c) });
  };
  const later = (ms: number) => {
    if (!trailing) trailing = w.setTimeout(check, Math.max(ms, CHECK_MS));
  };

  const obs = new w.MutationObserver(() => {
    lastChange = Date.now();
    dirty = true;
    if (Date.now() - lastCheck >= CHECK_MS) check();
    else later(CHECK_MS - (Date.now() - lastCheck));
  });
  obs.observe(doc, ANY_CHANGE);

  function stop() {
    stopped = true;
    obs.disconnect();
    w.clearTimeout(trailing);
  }
  check();
  return stop;
}
