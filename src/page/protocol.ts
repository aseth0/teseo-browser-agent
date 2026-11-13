// Messages from the background to the script injected in the page (page-agent).
import type { DomFound } from '../content/dom-find';
import type { HtmlRead } from '../content/dom-html';
import type { PageMeta } from '../content/extractors';
import type { StructuredData } from '../content/page-values';
import type { Clipped } from '../core/clip';
import type { ActionOutcome } from '../core/model-texts';
import type { PageValue } from '../skills/variables';
import type { TemplateRun } from '../templates/liquid';
import type { WaitOutcome } from '../content/wait';
import type { WatchFired, WatchSpec } from '../content/watch';
import type { Focused, Located } from '../content/locate';

export type PageAction =
  | { kind: 'click'; ref: string }
  | { kind: 'type'; ref: string; text: string; clear?: boolean; submit?: boolean }
  | { kind: 'select'; ref: string; value: string }
  | { kind: 'key'; key: string; ref?: string }
  | { kind: 'scroll'; direction: 'up' | 'down' | 'left' | 'right'; ref?: string };

export type PageRequest =
  // meta + selection + viewport snapshot, in one round trip (interactive elements by default)
  | { op: 'context'; maxNodes: number; filter?: 'interactive' | 'all'; maxChars?: number } // maxChars: of the selected text
  | { op: 'snapshot'; ref?: string; filter?: 'interactive' | 'all'; maxDepth?: number; maxNodes?: number }
  | { op: 'text'; maxChars?: number; from?: number } // from: the character to start from, to read on after a cut
  | { op: 'selection'; maxChars?: number } // the text selected now (the panel's chip: what the page block will carry)
  | { op: 'find'; query: string }
  | { op: 'find-in-dom'; selector: string; attr?: string; limit: number } // browser.find_in_dom (content/dom-find)
  | { op: 'get-html'; selector: string; from?: number; max: number } // browser.get_html (content/dom-html)
  | { op: 'structured' }
  | { op: 'values'; vars: string[]; maxChars?: number; maxItems?: number } // site skill variables (skills/variables)
  | { op: 'template'; views: Record<string, string>; view: string; maxChars?: number } // a view of a page template (templates/liquid), its values marked as page content
  | { op: 'describe'; ref: string } // 'button "Buy now"', for confirmations
  | { op: 'act'; action: PageAction; host?: string } // returns what was done; host: only on that site (the one approved)
  // any engine input: our widget lets the pointer through until input-end (content/locate), and whether the tab is shown; host: only on that site
  | { op: 'input-start'; host?: string }
  | { op: 'input-end'; token: string }
  // browser.click: a watch on what the click changes, from right before the press (content/change); null: not watched
  | { op: 'change-start'; ref: string }
  | { op: 'change-end'; token: string }
  // browser.click/press_key/type on the engine: where real input lands for the element (content/locate); host: only on that site
  | { op: 'locate'; ref: string; focus?: boolean; host?: string }
  // browser.press_key on the engine without a ref: the page reached (its site access), and the focus in this frame
  | { op: 'focused'; host?: string }
  // browser.scroll on the engine: where its wheel turns (content/locate wheelAt)
  | { op: 'wheel-point'; ref?: string; host?: string }
  // browser.type on the engine: the field emptied or its contents selected, for real input to type over (content/locate)
  | { op: 'clear'; ref: string; host?: string }
  // the same with clear=false: the caret at the end of the field, for real input to add to it
  | { op: 'caret-end'; ref: string; host?: string }
  // browser.type/press_key on the engine: where to press for the page to get the browser's focus, if it lacks it (content/locate)
  | { op: 'focus-spot'; ref?: string; host?: string }
  // and whether real input arrived: what the field holds, the key presses the page has seen
  | { op: 'field-text'; ref: string; host?: string }
  | { op: 'keys-seen' }
  // browser.screenshot on the engine: sensitive fields painted over while it captures (content/mask), then taken away
  | { op: 'mask'; selectors: string[] }
  | { op: 'unmask'; token: string }
  | { op: 'remask'; token: string; selectors: string[] } // after a screenshot's view changed the layout
  // a tabs-and-mouse recording: the user's steps told under its key (content/steps), then no more
  | { op: 'steps-start'; key: string }
  | { op: 'steps-stop'; key: string }
  | { op: 'settle' } // resolves once the DOM has been quiet for a moment
  // browser.wait_for: until its conditions are met or timeoutMs passes (content/wait)
  | { op: 'wait'; gone?: string; appears?: string; ref?: string; stableMs?: number; timeoutMs: number; returnText?: boolean; maxChars?: number }
  | { op: 'sign-in' } // whether the page asks to sign in (content/sign-in)
  | { op: 'pick'; prompt: string } // the user clicks an element (user.pick_element); null when given up
  | { op: 'pick-cancel' }
  // browser.watch: watches on its own, answered at once; WATCH_FIRED tells once it is met (content/watch)
  | ({ op: 'watch-start'; id: string } & WatchSpec)
  | { op: 'watch-stop'; id: string };

interface PageContext {
  meta: PageMeta;
  selection: Clipped;
  snapshot: Clipped;
}

export interface PageResults {
  context: PageContext;
  snapshot: Clipped;
  text: { title: string; markdown: Clipped };
  selection: Clipped;
  find: string[];
  'find-in-dom': DomFound;
  'get-html': HtmlRead;
  structured: StructuredData;
  values: Record<string, PageValue>;
  template: TemplateRun;
  describe: string;
  'sign-in': boolean;
  act: ActionOutcome;
  'input-start': { token: string; hidden: boolean };
  'input-end': null;
  'change-start': string | null;
  'change-end': boolean; // whether the page changed
  locate: Located;
  focused: Focused;
  'wheel-point': { x: number; y: number; width: number; height: number };
  clear: 'emptied' | 'selected';
  'caret-end': null;
  'focus-spot': { x: number; y: number } | null;
  'field-text': string;
  'keys-seen': number;
  mask: { token: string; count: number };
  unmask: boolean; // false: the mask was gone (the page changed)
  remask: number;
  'steps-start': null;
  'steps-stop': null;
  settle: null;
  wait: WaitOutcome;
  pick: { ref: string; element: string } | null;
  'pick-cancel': null;
  'watch-start': null;
  'watch-stop': null;
}

export type PageResult<R extends PageRequest> = PageResults[R['op']];

export type PageResponse<D = unknown> = { ok: true; data: D } | { ok: false; error: string };

// browser.wait_for's stableMs when no condition is given (content/wait; the tool's description says it).
export const DEFAULT_STABLE_MS = 1500;

// The tag of the widget's hosts on the page (widget/ui/dom): what the content scripts leave alone.
export const WIDGET_TAG = 'ba-widget';

export const PAGE_MESSAGE = 'browser-agent:page';
// From the injected script to the extension: the page's selected text changed (the panel reads it
// again with the op "selection").
export const SELECTION_CHANGED = 'browser-agent:selection-changed';

// To the injected script: a request, answered with its op's result (core/runtime's ReplyOf).
export interface PageMessage<R extends PageRequest = PageRequest> {
  type: typeof PAGE_MESSAGE;
  req: R;
}
// From the injected script to the background: a watch was met (it has stopped).
export const WATCH_FIRED = 'browser-agent:watch-fired';

export type PageScriptMessage = PageMessage | { type: typeof SELECTION_CHANGED } | { type: typeof WATCH_FIRED; id: string; fired: WatchFired };
export interface PageReplies {
  [PAGE_MESSAGE]: PageResponse<PageResult<PageRequest>>;
  [SELECTION_CHANGED]: void;
  [WATCH_FIRED]: void;
}
