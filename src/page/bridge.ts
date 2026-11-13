// Background ↔ tab: injects page-agent.js on demand and sends it requests.
import { browser } from 'wxt/browser';
import { actionNote, markPageData, text, type Origin } from '../core/model-texts';
import { errorText } from '../core/errors';
import { AccessRequiredError } from '../core/types';
import { hostOf, sleep } from '../core/util';
import { sendTab } from '../core/runtime';
import { accessRequest } from './access';
import { withTimeout } from './in-time';
import { isRestrictedUrl } from './permissions';
import { PAGE_MESSAGE, type PageAction, type PageRequest, type PageResponse, type PageResult } from './protocol';

// How long a tab is given to answer. A tab the browser hibernated or holds back in the background
// (energy or memory saving: Vivaldi does it to YouTube), or whose page is busy, may never answer:
// without a limit the agent would wait forever, with nothing in any log.
export const PAGE_TIMEOUT_MS = 15_000;
// How long waitForLoad waits by default.
const LOAD_WAIT_MS = 8000;

// The tab did not answer in time: asleep, so injecting the script again would not help.
class PageTimeoutError extends Error {}

// Why the tab did not answer, as far as the browser says, and what the model can do about it.
async function lateError(tabId: number): Promise<PageTimeoutError> {
  type TabInfo = { title?: string; url?: string; status?: string; active?: boolean; discarded?: boolean; frozen?: boolean }; // frozen: Chrome 132+
  const tab: TabInfo | undefined = await browser.tabs.get(tabId).catch(() => undefined);
  const late = `did not answer in ${PAGE_TIMEOUT_MS / 1000} s`;
  if (!tab) return new PageTimeoutError(`The tab ${tabId} ${late}: it is closed.`);
  const named = `The tab ${tabId} ("${markPageData(tab.title ?? '')}" on ${hostOf(tab.url) || 'no page'})`;
  const asleep = [tab.discarded && 'discarded (hibernated)', tab.frozen && 'frozen', tab.status !== 'complete' && `still ${tab.status}`].filter(Boolean).join(', ');
  if (tab.active) return new PageTimeoutError(`${named} ${late}: the page is busy or not responding${asleep ? ` (${asleep})` : ''}. Tell the user, or work with another tab.`);
  // A tab read again in a fresh background tab answers: for reading only, since its refs are another
  // copy's.
  const reread = tab.url && /^https?:/.test(tab.url) ? ` or read its page with web__read with ${tab.url} (a fresh copy in a background tab: for reading only, its refs cannot be clicked in this tab)` : '';
  return new PageTimeoutError(
    `${named} ${late} while in the background${asleep ? ` (${asleep})` : ''}: the browser holds back background tabs to save energy or memory. ` +
      `Ask the user to bring it to the front and try again,${reread || ' or work with another tab'}.`,
  );
}

// The step, or an error saying why the tab did not answer once the time is up. `req.op === 'pick'`
// waits for the user, as long as it takes; `'wait'` is given its own time on top.
async function inTime<T>(tabId: number, step: Promise<T>, op: PageRequest['op'], extraMs = 0): Promise<T> {
  if (op === 'pick') return step;
  return withTimeout(step, PAGE_TIMEOUT_MS + extraMs, async () => {
    throw await lateError(tabId);
  });
}

function send<R extends PageRequest>(tabId: number, req: R): Promise<PageResponse<PageResult<R>> | undefined> {
  return inTime(tabId, sendTab(tabId, { type: PAGE_MESSAGE, req }), req.op, req.op === 'wait' ? req.timeoutMs : 0);
}

// Injects page-agent.js (idempotent: the script ignores a second injection). Without access to
// the site it throws AccessRequiredError, naming the tab, so the user can be asked. Access is not
// checked beforehand: activeTab can allow a tab whose site has no permission.
async function inject(tabId: number): Promise<void> {
  const tab = await browser.tabs.get(tabId);
  if (isRestrictedUrl(tab.url)) throw new Error(`The browser does not allow reading ${tab.url ?? 'this page'}.`);
  try {
    await inTime(tabId, browser.scripting.executeScript({ target: { tabId }, files: ['/page-agent.js'] }), 'act');
  } catch (e) {
    const msg = errorText(e);
    if (/permission|Cannot access/i.test(msg)) {
      const access = accessRequest(tab.url!, tab.title);
      throw new AccessRequiredError(access, `No permission to read the tab "${markPageData(access.title)}" (${access.site}): the user has not allowed this site.`);
    }
    throw e;
  }
}

// Page content is marked with its origin (core/model-texts): the op's own, or the one given
// (e.g. the page after an action is a tool result, not the page block).
export async function callPage<R extends PageRequest>(tabId: number, req: R, origin?: Origin): Promise<PageResult<R>> {
  let res: PageResponse<PageResult<R>> | undefined;
  try {
    res = await send(tabId, req);
  } catch (e) {
    if (e instanceof PageTimeoutError) throw e; // asleep: injecting would not help
    // "Receiving end does not exist": not injected yet (or the page navigated).
  }
  if (!res) {
    await inject(tabId);
    res = await send(tabId, req);
  }
  if (!res) throw new Error('The page did not respond');
  if (!res.ok) throw new Error(markPageData(res.error)); // it may quote the page (a select's options, its exceptions)
  const marked = origin ?? PAGE_DATA_OPS[req.op];
  return marked ? markPageData(res.data, marked) : res.data;
}

// The requests whose replies are page content that reaches the model, and their origin.
const PAGE_DATA_OPS: Partial<Record<PageRequest['op'], Origin>> = {
  context: 'page',
  selection: 'page',
  values: 'skillValues',
  snapshot: 'tool',
  text: 'tool',
  find: 'tool',
  'find-in-dom': 'tool',
  'get-html': 'tool',
  structured: 'tool',
  pick: 'tool',
};

// Runs an action exactly once. callPage would re-inject and resend if the reply never
// arrives, but for actions that usually means the action worked and navigated away.
// With `host` (the site the call was approved for), the page acts only while still on it.
export async function actOnPage(tabId: number, action: PageAction, host?: string): Promise<string> {
  await inject(tabId);
  try {
    const res = await send(tabId, { op: 'act', action, ...(host !== undefined && { host }) });
    if (!res) return text('action.navigated');
    if (!res.ok) throw new Error(markPageData(res.error)); // it may quote the page (a select's options, its exceptions)
    return actionNote(res.data);
  } catch (e) {
    // Nothing listens in the page the script was just injected into: the action never reached it.
    if (/Receiving end does not exist/i.test(errorText(e))) throw new Error('Not done: the page script did not answer in the tab (it may be loading). Read the page again and retry.');
    if (isNavigationError(e)) return text('action.navigated');
    throw e;
  }
}

// Waits until the tab finishes loading (no-op when it already has).
export async function waitForLoad(tabId: number, timeoutMs = LOAD_WAIT_MS): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await browser.tabs.get(tabId);
    if (tab.status === 'complete') return;
    await sleep(100);
  }
}

// What a message to a page meets when the page goes away under it: it navigated (or went into the
// back/forward cache), so its content script is gone or not there yet.
export const isNavigationError = (e: unknown) => /port closed|context invalidated|back\/forward cache|Receiving end does not exist|Frame with ID \d+ was removed/i.test(errorText(e));
