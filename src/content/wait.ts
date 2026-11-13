// browser.wait_for in the page: waits until an element is gone or appears (matched like
// browser.find), and/or an area stops changing, and reports which conditions were met (the background
// says them in words: watches/conditions). A
// MutationObserver notes the changes; the conditions are checked again at most every CHECK_MS.
import { clip, type Clipped } from '../core/clip';
import { DEFAULT_STABLE_MS } from '../page/protocol';
import { type RefStore, tracker } from './a11y';
import { ANY_CHANGE } from './actions';
import type { Condition } from './watch';

const CHECK_MS = 250;
const TEXT_CHARS = 20000; // of the text returned, when the background gives no maxChars

interface WaitSpec {
  gone?: string;
  appears?: string;
  root?: Element; // the area watched by stableMs and read by returnText (else the page)
  stableMs?: number;
  timeoutMs: number;
  returnText?: boolean;
  maxChars?: number;
}

export interface WaitOutcome {
  done: boolean;
  ms: number;
  met: Condition[];
  pending: Condition[];
  text?: Clipped;
}

export function waitFor(doc: Document, refs: RefStore, spec: WaitSpec): Promise<WaitOutcome> {
  const w = doc.defaultView!;
  const root = spec.root ?? doc.body ?? doc.documentElement;
  const stableMs = spec.stableMs ?? (spec.gone || spec.appears ? undefined : DEFAULT_STABLE_MS);
  const start = Date.now();
  let lastChange = start;
  let dirty = true; // the element conditions are checked again only after a change
  let found = { gone: false, appears: false };

  return new Promise((resolve) => {
    const obs = new w.MutationObserver(() => {
      lastChange = Date.now();
      dirty = true;
    });
    obs.observe(root, ANY_CHANGE);
    // Elements come and go anywhere on the page, not only in the watched area.
    const pageObs = root === doc.body || root === doc.documentElement ? undefined : new w.MutationObserver(() => (dirty = true));
    pageObs?.observe(doc, ANY_CHANGE);

    // The element found is kept and read again; the page is searched again only once it is not there,
    // and not at every check (tracker).
    const gone = spec.gone ? tracker(doc, refs, spec.gone, CHECK_MS) : undefined;
    const appears = spec.appears ? tracker(doc, refs, spec.appears, CHECK_MS) : undefined;
    const conditions = () => {
      const now = Date.now();
      if (dirty) {
        const g = gone?.();
        const a = appears?.();
        dirty = g?.retryIn !== undefined || a?.retryIn !== undefined; // a search still due: the next check runs it
        found = {
          // Not found in a search that was cut (a page past its nodes) is not gone: it may be past the cut.
          gone: !!g && !g.found && !g.truncated,
          appears: !!a?.found,
        };
      }
      const all: [boolean, Condition][] = [];
      if (spec.gone) all.push([found.gone, { kind: 'gone', query: spec.gone }]);
      if (spec.appears) all.push([found.appears, { kind: 'appears', query: spec.appears }]);
      if (stableMs !== undefined) all.push([now - lastChange >= stableMs, { kind: 'stable', ms: stableMs }]);
      return all;
    };

    const check = () => {
      const all = conditions();
      const ms = Date.now() - start;
      const done = all.every(([ok]) => ok);
      if (!done && ms < spec.timeoutMs) return;
      w.clearInterval(timer);
      obs.disconnect();
      pageObs?.disconnect();
      resolve({
        done,
        ms,
        met: all.filter(([ok]) => ok).map(([, c]) => c),
        pending: all.filter(([ok]) => !ok).map(([, c]) => c),
        ...(spec.returnText && { text: clip((root as HTMLElement).innerText ?? root.textContent ?? '', spec.maxChars ?? TEXT_CHARS) }),
      });
    };
    const timer = w.setInterval(check, CHECK_MS);
    check();
  });
}
