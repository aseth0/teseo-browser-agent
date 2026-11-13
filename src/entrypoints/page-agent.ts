// Script the background injects into the tab on demand (chrome.scripting).
// It runs in the "isolated world": the page can neither see nor tamper with its variables.
import { asksToSignIn } from '../content/sign-in';
import { find, RefStore, snapshot } from '../content/a11y';
import { describeElement } from '../content/a11y-names';
import { findInDom } from '../content/dom-find';
import { getHtml } from '../content/dom-html';
import type { Clipped } from '../core/clip';
import type { ActionOutcome } from '../core/model-texts';
import { bringIntoView, click, pressKey, scroll, selectOption, typeText, waitForSettle } from '../content/actions';
import { endChange, startChange } from '../content/change';
import { caretAtEnd, clearField, fieldText, focused, focusSpot, inputEnd, inputStart, keysSeenCount, locate, wheelAt } from '../content/locate';
import { maskPage, remaskPage, unmaskPage } from '../content/mask';
import { watchSteps } from '../content/steps';
import { pageMeta, readableMarkdown, selectionText, structuredData, variableValues } from '../content/extractors';
import { cancelPick, pickElement } from '../content/picker';
import { runTemplate } from '../content/template-run';
import { waitFor } from '../content/wait';
import { startWatch } from '../content/watch';
import { onRuntime, sendRuntime } from '../core/runtime';
import { PAGE_MESSAGE, SELECTION_CHANGED, WATCH_FIRED, type PageAction, type PageRequest, type PageResponse, type PageResult, type PageResults } from '../page/protocol';
import { errorText } from '../core/errors';
import { contextAlive, takeOver, type PageCopy } from '../content/page-copy';

declare global {
  interface Window {
    __browserAgentPage?: PageCopy | boolean; // boolean: an older build's mark
  }
}

const SELECTION_SETTLE_MS = 300; // the selection told once it stops changing

// Told to the extension, unanswered (no panel open, the recording over: dropped). False once the
// extension was reloaded or removed ("Extension context invalidated"): this copy of the script is left
// behind in the page.
function notify(message: Parameters<typeof sendRuntime>[0]): boolean {
  try {
    sendRuntime(message).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
}

export default defineUnlistedScript(() => {
  if (!takeOver(window.__browserAgentPage)) return; // already injected, and listening

  const refs = new RefStore();
  const clipOf = (s: Clipped): Clipped => ({ text: s.text, truncated: s.truncated });

  const resolve = (ref: string): Element => {
    const el = refs.get(ref);
    if (!el) throw new Error(`${ref} no longer exists on the page; read it again`);
    return el;
  };

  // The site may have changed while the user was asked: never act on one they did not approve.
  const sameSite = (host: string | undefined) => {
    if (host !== undefined && location.host !== host) throw new Error(`Not done: the tab is now on ${location.host || location.href}, not on ${host}, where the action was allowed.`);
  };

  const act = async (a: PageAction): Promise<ActionOutcome> => {
    switch (a.kind) {
      case 'click':
        return { kind: 'click', ...click(resolve(a.ref)) };
      case 'type':
        await typeText(resolve(a.ref), a.text, { clear: a.clear, submit: a.submit });
        return { kind: 'type', submit: a.submit };
      case 'select':
        return { kind: 'select', option: selectOption(resolve(a.ref), a.value) };
      case 'key':
        pressKey(a.ref ? resolve(a.ref) : (document.activeElement ?? document.body), a.key);
        return { kind: 'key', key: a.key };
      case 'scroll':
        scroll(a.ref ? resolve(a.ref) : window, a.direction);
        return { kind: 'scroll', direction: a.direction };
    }
  };

  // The watches running in this page (browser.watch), by id. Starting one again replaces it. Once
  // met, the background is told; a copy left behind by a reloaded extension cannot tell it.
  const watches = new Map<string, () => void>();
  const stepWatches = new Map<string, () => void>(); // a tabs-and-mouse recording's, by its key
  const stopWatch = (id: string) => {
    watches.get(id)?.();
    watches.delete(id);
    return null;
  };

  // Each op's handler, checked against the result its request expects (page/protocol).
  type Handlers = { [K in PageRequest['op']]: (req: Extract<PageRequest, { op: K }>) => PageResults[K] | Promise<PageResults[K]> };
  const handlers: Handlers = {
    context: (req) => ({
      meta: pageMeta(document),
      selection: selectionText(document, req.maxChars),
      snapshot: clipOf(snapshot(document, refs, { filter: req.filter ?? 'interactive', viewportOnly: true, maxNodes: req.maxNodes })),
    }),
    snapshot: (req) => {
      const root = req.ref ? resolve(req.ref) : undefined;
      return clipOf(snapshot(document, refs, { root, filter: req.filter, maxDepth: req.maxDepth, maxNodes: req.maxNodes }));
    },
    text: (req) => readableMarkdown(document, req.maxChars, req.from),
    'sign-in': () => asksToSignIn(document, location.href),
    selection: (req) => selectionText(document, req.maxChars),
    find: (req) => find(document, refs, req.query).lines,
    'find-in-dom': (req) => findInDom(document, refs, req.selector, { attr: req.attr, limit: req.limit }),
    'get-html': (req) => getHtml(document, req.selector, { from: req.from, max: req.max }),
    structured: () => structuredData(document),
    values: (req) => variableValues(document, req.vars, req.maxChars, req.maxItems),
    template: (req) => runTemplate(document, req.views, req.view, req.maxChars),
    describe: (req) => describeElement(resolve(req.ref)),
    act: (req) => {
      sameSite(req.host);
      return act(req.action);
    },
    'input-start': (req) => {
      sameSite(req.host);
      return inputStart();
    },
    'input-end': (req) => inputEnd(req.token),
    'change-start': (req) => startChange(resolve(req.ref)),
    'change-end': (req) => endChange(req.token),
    locate: (req) => {
      sameSite(req.host);
      return locate(resolve(req.ref), { focus: req.focus });
    },
    focused: (req) => {
      sameSite(req.host);
      return focused();
    },
    'wheel-point': (req) => {
      sameSite(req.host);
      const el = req.ref ? resolve(req.ref) : undefined;
      if (el) bringIntoView(el);
      return wheelAt(el);
    },
    clear: (req) => {
      sameSite(req.host);
      return clearField(resolve(req.ref));
    },
    'caret-end': (req) => {
      sameSite(req.host);
      caretAtEnd(resolve(req.ref));
      return null;
    },
    'focus-spot': (req) => {
      sameSite(req.host);
      return focusSpot(req.ref ? resolve(req.ref) : undefined);
    },
    'field-text': (req) => {
      sameSite(req.host);
      return fieldText(resolve(req.ref));
    },
    'keys-seen': () => keysSeenCount(),
    mask: (req) => maskPage(document, req.selectors),
    unmask: (req) => unmaskPage(document, req.token),
    remask: (req) => remaskPage(document, req.token, req.selectors),
    'steps-start': ({ key }) => {
      stepWatches.get(key)?.();
      stepWatches.set(key, watchSteps(document, (step) => void notify({ type: 'recording-step', key, step })));
      return null;
    },
    'steps-stop': ({ key }) => {
      stepWatches.get(key)?.();
      stepWatches.delete(key);
      return null;
    },
    settle: () => waitForSettle(document).then(() => null),
    wait: ({ ref, ...spec }) => waitFor(document, refs, { ...spec, root: ref ? resolve(ref) : undefined }),
    pick: (req) => pickElement(document, req.prompt).then((el) => el && { ref: refs.refFor(el), element: describeElement(el) }),
    'pick-cancel': () => {
      cancelPick();
      return null;
    },
    'watch-start': ({ id, op: _op, ...spec }) => {
      stopWatch(id);
      const stop = startWatch(document, refs, spec, (fired) => {
        watches.delete(id);
        notify({ type: WATCH_FIRED, id, fired }); // cut off: the background re-injects its watches
      });
      watches.set(id, stop);
      return null;
    },
    'watch-stop': ({ id }) => stopWatch(id),
  };
  // TypeScript does not tie an op to its own request: the handler is the op's (Handlers says so).
  type AnyResult = PageResult<PageRequest>;
  const handle = (req: PageRequest): AnyResult | Promise<AnyResult> => (handlers[req.op] as (req: PageRequest) => AnyResult | Promise<AnyResult>)(req);

  // The panel shows when selected text will go with the next message: it is told when the selection
  // changes (once it settles), and reads it again. Once the extension is reloaded or removed this
  // copy of the script is left behind in the page, and stops listening.
  let selected = selectionText(document).text;
  let settling: ReturnType<typeof setTimeout> | undefined;
  const tell = () => {
    const now = selectionText(document).text;
    if (now === selected) return;
    selected = now;
    if (!notify({ type: SELECTION_CHANGED })) document.removeEventListener('selectionchange', onSelectionChange);
  };
  const onSelectionChange = () => {
    clearTimeout(settling);
    settling = setTimeout(tell, SELECTION_SETTLE_MS);
  };
  document.addEventListener('selectionchange', onSelectionChange);

  // Once the extension is reloaded, the copy it injects next takes over from this one.
  window.__browserAgentPage = {
    alive: contextAlive,
    retire: () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      clearTimeout(settling);
      for (const stop of [...watches.values(), ...stepWatches.values()]) stop();
      watches.clear();
      stepWatches.clear();
    },
  };

  onRuntime(PAGE_MESSAGE, ({ req }) => {
    if (!req) return;
    return Promise.resolve()
      .then(() => handle(req))
      .then(
        (data): PageResponse<AnyResult> => ({ ok: true, data }),
        (e): PageResponse<AnyResult> => ({ ok: false, error: errorText(e) }),
      );
  });
});
