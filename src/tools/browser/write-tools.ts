// Generic tools that act on the page through refs. Every one except scroll is a
// "write" tool, so it runs only after the site policy or the user allows it.
import { type Browser, browser } from 'wxt/browser';
import { limit } from '../../core/limits';
import type { ActionDetail, Tool, ToolContext, ToolResult } from '../../core/types';
import { sleep } from '../../core/util';
import { text, withMarker } from '../../core/model-texts';
import { actOnPage, callPage, waitForLoad } from '../../page/bridge';
import type { PageAction } from '../../page/protocol';
import { defineTool, fields, optBoolean, optNumber, optString } from '../define';
import { tabIdProp, tabOfArgs, targetTab } from './tab-target';

export const refProp = { ref: { type: 'string', description: 'Element reference from the page snapshot, e.g. "ref_k3x_12"' } };
// A call that left out its element's ref: where to get one.
export const refMissing = (required: string[]) =>
  required.includes('ref')
    ? { missingHints: { ref: 'the element\'s ref ("ref_k3x_12") comes from the page as it is now: read it (browser__read_page) or find the field (browser__find) first; after a navigation, the refs from before are gone.' } }
    : {};

export async function describeRef(args: { tabId?: number; ref: string }, ctx: ToolContext): Promise<string> {
  return callPage(targetTab(args, ctx), { op: 'describe', ref: args.ref });
}

// browser.click's watch on what the click changes: the page's (content/change, from right before the
// press) and a tab opened from it. end() in every case, the action failed too.
export interface ClickWatch {
  changed: () => Promise<boolean>;
  end: () => void;
}
export async function watchClick(tabId: number, ref: string): Promise<ClickWatch> {
  let opened = false;
  const onCreated = (tab: Browser.tabs.Tab) => {
    if (tab.openerTabId === tabId) opened = true;
  };
  browser.tabs.onCreated.addListener(onCreated);
  // null: a click the page does not show (a native picker, a download), or the watch could not start.
  const token = await callPage(tabId, { op: 'change-start', ref }).catch(() => null);
  return {
    // A page that went away (it navigated) changed.
    changed: async () => opened || token === null || (await callPage(tabId, { op: 'change-end', token }).catch(() => true)),
    end: () => browser.tabs.onCreated.removeListener(onCreated),
  };
}

// After acting: let the page react (navigation, re-render), then show the model the result. With a
// click's watch, a click that changed nothing says so.
export async function afterAction(tabId: number, note: string, watch?: ClickWatch): Promise<ToolResult> {
  await sleep(300);
  await waitForLoad(tabId);
  await callPage(tabId, { op: 'settle' }).catch(() => undefined);
  // A covered click's note already says it may not have been taken.
  const done = watch && note === text('action.click') && !(await watch.changed()) ? text('action.click_no_change') : note;
  // Text too (filter 'all'): confirmations, errors and toasts are usually plain text.
  const ctx = await callPage(tabId, { op: 'context', maxNodes: limit('pageElements'), filter: 'all' }, 'tool');
  const visible = withMarker(ctx.snapshot, 'pageElements', 'result.snapshot_truncated');
  // The elements named too: later requests of the turn may send only the latest (context/in-run).
  return { type: 'text', text: text('result.after_action', { action_note: done, url: ctx.meta.url, title: ctx.meta.title, visible_elements: visible }), elements: visible };
}

// The arguments every action takes: the tab (none: the panel's) and the element.
type Target = { tabId?: number; ref?: string };

function actionTool<A extends Target>(spec: {
  name: string;
  description: string;
  properties: Record<string, unknown>;
  required: string[];
  effect?: Tool['effect'];
  args: (a: Record<string, unknown>) => A;
  toAction: (a: A) => PageAction;
  summary?: (a: A, target: string) => string;
  details?: (a: A) => ActionDetail[]; // what the summary leaves out, such as a long text
  watch?: boolean; // a click: the reply says when it changed nothing
}): Tool {
  return defineTool({
    name: spec.name,
    description: spec.description,
    inputSchema: { type: 'object', properties: { ...tabIdProp, ...spec.properties }, required: spec.required },
    ...refMissing(spec.required),
    source: 'browser',
    effect: spec.effect ?? 'write',
    args: (raw) => ({ ...spec.args(fields(raw)), tabId: optNumber(fields(raw).tabId) }),
    tabOf: (a) => tabOfArgs(a), // the policy judges the call by that tab's site
    describe: async (a, ctx) => {
      const target = a.ref ? await describeRef({ tabId: a.tabId, ref: a.ref }, ctx) : 'the page';
      return { summary: spec.summary?.(a, target) ?? `${spec.name} on ${target}`, details: spec.details?.(a) };
    },
    run: async (a, ctx) => {
      const tabId = targetTab(a, ctx);
      const watch = spec.watch && a.ref ? await watchClick(tabId, a.ref) : undefined;
      try {
        return await afterAction(tabId, await actOnPage(tabId, spec.toAction(a), ctx.approvedHost), watch);
      } finally {
        watch?.end();
      }
    },
  });
}

export const DIRECTIONS = ['up', 'down', 'left', 'right'] as const;
export const direction = (v: unknown): (typeof DIRECTIONS)[number] => {
  const d = DIRECTIONS.find((x) => x === v);
  if (!d) throw new Error(`direction must be one of ${DIRECTIONS.join(', ')}`);
  return d;
};

// browser.type's card, here and on the engine: the text in a block of its own (a long one buried in
// the summary was hard to review).
export const typeSummary = (a: { clear?: boolean; submit?: boolean }, target: string) =>
  `Type into ${target}${a.clear === false ? ', after its current text' : ''}${a.submit ? ', then press Enter' : ''}`;
export const typeDetails = (a: { text: string }): ActionDetail[] => [{ label: `Text · ${[...a.text].length} chars`, value: a.text, code: true }];

export function writeTools(): Tool[] {
  return [
    actionTool({
      name: 'browser.click',
      description: 'Clicks an element by ref (buttons, links, checkboxes, menu items...). Returns the page state afterwards.',
      properties: refProp,
      required: ['ref'],
      args: (a) => ({ ref: String(a.ref) }),
      toAction: (a) => ({ kind: 'click', ref: a.ref }),
      summary: (_a, target) => `Click ${target}`,
      watch: true,
    }),
    actionTool({
      name: 'browser.type',
      description: 'Types text into a text field by ref. Replaces the current value unless clear=false. submit=true presses Enter afterwards.',
      properties: { ...refProp, text: { type: 'string' }, clear: { type: 'boolean' }, submit: { type: 'boolean' } },
      required: ['ref', 'text'],
      args: (a) => ({ ref: String(a.ref), text: String(a.text), clear: optBoolean(a.clear), submit: optBoolean(a.submit) }),
      toAction: (a) => ({ kind: 'type', ref: a.ref, text: a.text, clear: a.clear, submit: a.submit }),
      summary: (a, target) => typeSummary(a, target),
      details: (a) => typeDetails(a),
    }),
    actionTool({
      name: 'browser.select',
      description: 'Chooses an option of a <select> (combobox) by its visible text or value.',
      properties: { ...refProp, value: { type: 'string' } },
      required: ['ref', 'value'],
      args: (a) => ({ ref: String(a.ref), value: String(a.value) }),
      toAction: (a) => ({ kind: 'select', ref: a.ref, value: a.value }),
      summary: (a, target) => `Select "${a.value}" in ${target}`,
    }),
    actionTool({
      name: 'browser.press_key',
      description: 'Presses a key (Enter, Escape, Tab, ArrowDown...) on an element by ref, or on the focused element.',
      properties: { ...refProp, key: { type: 'string' } },
      required: ['key'],
      args: (a) => ({ key: String(a.key), ref: optString(a.ref) }),
      toAction: (a) => ({ kind: 'key', key: a.key, ref: a.ref }),
      summary: (a, target) => `Press ${a.key} on ${target}`,
    }),
    actionTool({
      name: 'browser.scroll',
      description: 'Scrolls the page (or a scrollable element by ref) to reveal more content.',
      properties: { ...refProp, direction: { type: 'string', enum: [...DIRECTIONS] } },
      required: ['direction'],
      effect: 'read',
      args: (a) => ({ direction: a.direction, ref: optString(a.ref) }),
      toAction: (a) => ({ kind: 'scroll', direction: direction(a.direction), ref: a.ref }), // checked when it runs only
    }),
    defineTool({
      name: 'browser.navigate',
      description: 'Opens a URL (http/https) in the tab.',
      inputSchema: { type: 'object', properties: { ...tabIdProp, url: { type: 'string' } }, required: ['url'] },
      source: 'browser',
      effect: 'write',
      args: (raw) => ({ tabId: optNumber(fields(raw).tabId), url: String(fields(raw).url) }),
      tabOf: (a) => tabOfArgs(a),
      describe: async (a) => ({ summary: `Open ${a.url}`, url: a.url }),
      run: async (a, ctx) => {
        if (!/^https?:\/\//i.test(a.url)) throw new Error(text('error.navigate_not_web'));
        const tabId = targetTab(a, ctx);
        await browser.tabs.update(tabId, { url: a.url });
        return afterAction(tabId, text('action.navigate', { url: a.url }));
      },
    }),
    defineTool({
      name: 'browser.switch_tab',
      description:
        'Brings an open tab (tabId, from browser__list_tabs) to the front of its window, for the user to see it. The window itself is not focused: ' +
        'a tab in another window stays behind the one the user is in. It does not change the tab this chat works on (workingOn): your tools still ' +
        'act on that one unless you pass tabId. Use it only when the user asks, or once they agree (e.g. real input needs the tab in front).',
      inputSchema: { type: 'object', properties: { tabId: { type: 'number' } }, required: ['tabId'] },
      source: 'browser',
      effect: 'write',
      args: (raw) => ({ tabId: optNumber(fields(raw).tabId) }),
      tabOf: (a) => tabOfArgs(a),
      describe: async (a, ctx) => {
        const tab = await browser.tabs.get(targetTab(a, ctx)).catch(() => undefined);
        return { summary: `Switch to ${tab?.title || tab?.url || `tab ${a.tabId}`}` };
      },
      run: async (a, ctx) => {
        const tabId = targetTab(a, ctx);
        // The tab only, in its window: the window itself is not focused.
        await browser.tabs.update(tabId, { active: true });
        const note = text('action.switch_tab');
        // A page the extension cannot read (the browser's own) is still in front.
        return afterAction(tabId, note).catch(() => ({ type: 'text' as const, text: `${note}.` }));
      },
    }),
  ];
}
