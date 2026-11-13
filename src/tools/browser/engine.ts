// The DevTools engine's input (Settings → Chromium DevTools on): the page script finds the element
// (content/locate) on the sites the extension can read, then devtools/cdp sends real input, checking
// before each event that the tab is still on the call's site. No fallback to synthetic events, but for
// a tab not shown (engine-tools): what cannot be done fails and says why.
import { browser } from 'wxt/browser';
import { actionNote, text, type ActionOutcome } from '../../core/model-texts';
import type { ToolContext, ToolResult } from '../../core/types';
import { collapseSpaces, hostOf } from '../../core/util';
import { withDebugger, type CdpSession } from '../../devtools/cdp';
import type { Located } from '../../content/locate';
import { callPage } from '../../page/bridge';
import { afterAction, type ClickWatch } from './write-tools';

export type Point = Extract<Located, { ok: true }>;

const invisible = /[\u200B-\u200D\uFEFF]/g; // an editor's own zero-width characters

// Whether text real input typed reached a field, from what it held just before and holds now. Any change
// says so: a field may reformat what it gets (a mask, a trim, a length limit). Only one that holds that
// very text already changes nothing when replaced; text '' is a delete.
export function textLanded(before: string, now: string, text: string, replace: boolean): boolean {
  const clean = (s: string) => collapseSpaces(s.replace(invisible, ''));
  return clean(now) !== clean(before) || (replace && clean(before) === clean(text));
}

// The tab must still be on the site the call started on, right before each event.
export async function assertSameHost(tabId: number, host: string) {
  const now = hostOf((await browser.tabs.get(tabId)).url);
  if (now !== host) throw new Error(`Not done: the tab is now on ${now || 'another page'}, not on ${host}, where the action was allowed.`);
}

// The element's point and box (focused first when asked), or why there is none.
export async function located(tabId: number, ref: string, focus: boolean, host: string): Promise<Point> {
  const found = await callPage(tabId, { op: 'locate', ref, focus, host });
  if (found.ok) return found;
  if (found.problem === 'covered') throw new Error(text('error.devtools_covered', { other: found.other }));
  throw new Error(text(found.problem === 'no-box' ? 'error.devtools_no_box' : 'error.devtools_in_frame'));
}

// No element named: the input goes to the focused one, which must be in the page's own frame. Through
// the page in every case: it checks the site access, as the browser.* tools do.
async function focusHere(tabId: number, host: string): Promise<undefined> {
  const found = await callPage(tabId, { op: 'focused', host });
  if (!found.ok) throw new Error(text('error.devtools_in_frame'));
  return undefined;
}

// The site the call was allowed on (the policy's), else the tab's now.
export const startHost = async (tabId: number, ctx: ToolContext) => ctx.approvedHost ?? hostOf((await browser.tabs.get(tabId)).url);

interface EngineSteps {
  ref?: string;
  focus: boolean;
  locate?: boolean; // false: the tool reaches the page itself (scroll's wheel point)
  send: (s: CdpSession, at: Point | undefined, check: () => Promise<void>, host: string) => Promise<void>;
}

const INPUT_ANSWER_MS = 3000;
const NO_ANSWER = 'The page did not respond to the input in 3 s: it may be busy, or it opened a dialog (alert, confirm). If a dialog is open, ask the user to answer it, then go on.';

// Input events wait for the page; one that opened a dialog never returns (the browser shows the
// dialog to the user, as always). Past 3 s the call ends and says so.
function answering(s: CdpSession): CdpSession {
  return {
    ...s,
    send: <T>(method: Parameters<CdpSession['send']>[0], params?: Record<string, unknown>) => {
      if (!method.startsWith('Input.')) return s.send<T>(method, params);
      let timer: ReturnType<typeof setTimeout> | undefined;
      const late = new Promise<never>((_, reject) => (timer = setTimeout(() => reject(new Error(NO_ANSWER)), INPUT_ANSWER_MS)));
      return Promise.race([s.send<T>(method, params), late]).finally(() => clearTimeout(timer));
    },
  };
}

// Real input for one call.
export async function engineInput(tabId: number, ctx: ToolContext, steps: EngineSteps, host?: string): Promise<void> {
  const site = host ?? (await startHost(tabId, ctx));
  const at = steps.locate === false ? undefined : steps.ref ? await located(tabId, steps.ref, steps.focus, site) : await focusHere(tabId, site);
  await withDebugger(tabId, (s) => steps.send(answering(s), at, () => assertSameHost(tabId, site), site));
}

// What the model gets: the page after the action, as the synthetic tools return it.
export const engineResult = (tabId: number, outcome: ActionOutcome, watch?: ClickWatch): Promise<ToolResult> => afterAction(tabId, actionNote(outcome), watch);

const QUIET_MS = 500;
export const IDLE_MOST_MS = 15_000;

// browser.wait_for's networkIdle: true once no request has been in flight for half a second, false
// after 15 s. Requests are counted by id only: nothing else about them is kept or returned.
export function networkIdle(tabId: number): Promise<boolean> {
  return withDebugger(
    tabId,
    (s) =>
      new Promise<boolean>((resolve) => {
        const inFlight = new Set<string>();
        let quiet: ReturnType<typeof setTimeout> | undefined;
        const most = setTimeout(() => finish(false), IDLE_MOST_MS);
        function finish(idle: boolean) {
          clearTimeout(quiet);
          clearTimeout(most);
          resolve(idle);
        }
        const settle = () => {
          clearTimeout(quiet);
          if (!inFlight.size) quiet = setTimeout(() => finish(true), QUIET_MS);
        };
        s.on('Network.requestWillBeSent', (p) => {
          inFlight.add(String(p.requestId));
          clearTimeout(quiet);
        });
        const ended = (p: Record<string, unknown>) => {
          inFlight.delete(String(p.requestId));
          settle();
        };
        s.on('Network.loadingFinished', ended);
        s.on('Network.loadingFailed', ended);
        s.send('Network.enable').then(settle, () => finish(false));
      }),
    { timeoutMs: IDLE_MOST_MS + 1000 },
  );
}
