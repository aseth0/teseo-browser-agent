// Generic read-only tools over tabs and pages.
import { conditionText } from '../../watches/conditions';
import { type Browser, browser } from 'wxt/browser';
import { limit, pageTextDefault, wrappedResultMax } from '../../core/limits';
import type { Tool, ToolContext, ToolResult } from '../../core/types';
import { markPageData, readOn, stripMarks, text, truncate, withMarker, withReadOn } from '../../core/model-texts';
import { callPage } from '../../page/bridge';
import { ownWindowIds } from '../../page/background-tab';
import { DEFAULT_STABLE_MS } from '../../page/protocol';
import { argumentDetails } from '../../core/argument-details';
import { fromParam } from '../read-more';
import { defineTool, fields, optBoolean, optFinite, optString } from '../define';
import { siteAccessTool } from './site-access';
import { tabIdProp, tabOfArgs, targetTab } from './tab-target';
import { bestEffort, errorText } from '../../core/errors';
import { blobOf, shrinkImage } from '../../core/image';

const DEFAULT_WAIT_SEC = 60;
export const SHOT_QUALITY = 0.6; // as captured

// A capture within Settings → Limits' longest side (a high-density screen captures twice the pixels); as it is when it fits.
export const sizedShot = async (shot: { mediaType: string; data: string }) =>
  (await bestEffort(shrinkImage(blobOf(shot), limit('screenshotSize'), { quality: SHOT_QUALITY, keep: shot }), 'screenshot-size')) ?? shot;

// What browser__get_page_text reads: the size the model asks for, at most Settings → Limits' maximum;
// none (or not a number), the default.
export const pageTextChars = (asked: unknown) =>
  typeof asked === 'number' && Number.isFinite(asked) && asked > 0 ? Math.min(Math.round(asked), limit('pageTextMax')) : pageTextDefault();

// What browser__get_html reads at once: the size the model asks for, at most what fits in a tool result.
export const htmlChars = (asked: number | undefined) => {
  const most = wrappedResultMax();
  return asked !== undefined && asked > 0 ? Math.min(Math.round(asked), most) : most;
};

// A read on another tab than the panel's is confirmed like an action (policy/engine): which tab
// the call names, and how the card shows it.
export const onTab: Pick<Tool, 'tabOf' | 'describe'> = {
  tabOf: tabOfArgs,
  describe: async function (this: Tool, args) {
    return { summary: `Read another tab with ${this.name}`, details: argumentDetails(args) };
  },
};

// A read on a tab, its arguments read with their types (`tabId` as given: targetTab reads it), the
// tab and the card from the call as the model wrote it.
type OnTab = { tabId: unknown };
function readOnTab<A>(spec: Omit<Tool, 'tabOf' | 'describe' | 'run' | 'source' | 'effect'> & { args: (a: Record<string, unknown>) => A; run(a: A & OnTab, ctx: ToolContext): Promise<ToolResult> }): Tool {
  const { args, ...rest } = spec;
  return { ...defineTool({ ...rest, source: 'browser', effect: 'read', args: (raw) => ({ ...args(fields(raw)), tabId: fields(raw).tabId }) }), ...onTab };
}

// The tabs browser.list_tabs marks: the one the chat works on, and the one the user is looking at (the
// active tab of the last focused window), which may be another.
type Marked = { chat?: number; user?: number };
const userTab = async () => (await browser.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id;

// A tab as browser.list_tabs lists it. Titles are the pages' own text: marked as such, like any page content.
const listedTab = (t: Browser.tabs.Tab, marked: Marked) => ({
  tabId: t.id,
  title: t.title && markPageData(t.title),
  url: t.url,
  ...(t.id === marked.chat && { workingOn: true }),
  ...(t.id === marked.user && { userOn: true }),
});

// Every window with its tabs, but the minimized ones the agent opens for a background tab.
async function allWindows(marked: Marked) {
  const [windows, own] = await Promise.all([browser.windows.getAll({ populate: true, windowTypes: ['normal', 'app', 'popup'] }), ownWindowIds()]);
  return windows
    .filter((w) => w.id === undefined || !own.includes(w.id))
    .map((w) => {
      const tabs = w.tabs ?? [];
      return {
        windowId: w.id,
        type: w.type,
        ...(w.focused && { focused: true }),
        ...(tabs.some((t) => t.id === marked.chat) && { hasWorkingTab: true }),
        activeTab: tabs.find((t) => t.active)?.id,
        tabs: tabs.map((t) => listedTab(t, marked)),
      };
    });
}

export function readTools(): Tool[] {
  return [
    defineTool({
      name: 'browser.list_tabs',
      description:
        'Lists open tabs (id, title, url; workingOn: the tab this chat works on, which may not be the one in front; userOn: the tab the user is looking at). By default only the window of the chat\'s tab. With window "all", every browser window, grouped by window: its type ("normal", "app" for an installed app, "popup"), whether it is focused, and its active tab. Use "all" to find a tab the user has open in another window or an app window, or the one they are looking at when it is in another window.',
      inputSchema: {
        type: 'object',
        properties: { window: { type: 'string', enum: ['current', 'all'], description: '"current" (default): only the window the chat\'s tab is in. "all": every window, to find a tab elsewhere.' } },
      },
      source: 'browser',
      effect: 'read',
      args: (raw) => ({ all: fields(raw).window === 'all' }),
      run: async (a, ctx) => {
        const marked = { chat: ctx.tabId, user: await userTab() };
        if (a.all) return { type: 'json', value: await allWindows(marked) };
        const chat = ctx.tabId === undefined ? undefined : await browser.tabs.get(ctx.tabId).catch(() => undefined);
        const tabs = await browser.tabs.query(chat ? { windowId: chat.windowId } : { lastFocusedWindow: true });
        return { type: 'json', value: tabs.map((t) => listedTab(t, marked)) };
      },
    }),
    readOnTab({
      name: 'browser.read_page',
      description:
        'Accessibility tree of the page with [ref_N] on every interactive element. Use ref to see only one area and filter="interactive" to reduce noise.',
      inputSchema: {
        type: 'object',
        properties: {
          ...tabIdProp,
          ref: { type: 'string', description: 'Root of the area to read, e.g. "ref_k3x_12"' },
          filter: { type: 'string', enum: ['all', 'interactive'] },
          maxDepth: { type: 'number' },
        },
      },
      args: ({ ref, filter, maxDepth }): { ref?: string; filter?: 'all' | 'interactive'; maxDepth?: number } => ({ ref: optString(ref), filter: filter === 'all' || filter === 'interactive' ? filter : undefined, maxDepth: optFinite(maxDepth) }),
      run: async (a, ctx) => {
        const res = await callPage(targetTab(a, ctx), { op: 'snapshot', ref: a.ref, filter: a.filter, maxDepth: a.maxDepth, maxNodes: limit('readPageElements') });
        const read = withMarker(res, 'readPageElements', 'result.snapshot_truncated');
        return { type: 'text', text: read ? text('result.page_read', { tool: 'browser.read_page', result: read }) : text('result.no_elements') };
      },
    }),
    readOnTab({
      name: 'browser.get_page_text',
      description: 'Main text of the page as Markdown (Readability). Best for summarizing or answering about the content.',
      inputSchema: {
        type: 'object',
        properties: { ...tabIdProp, maxChars: { type: 'number', get description() { return `Defaults to ${pageTextDefault()}`; } }, from: fromParam },
      },
      args: (a) => ({ maxChars: optFinite(a.maxChars), from: optFinite(a.from) }),
      run: async (a, ctx) => {
        const id = targetTab(a, ctx);
        const [res, tab] = await Promise.all([callPage(id, { op: 'text', maxChars: pageTextChars(a.maxChars), from: a.from }), browser.tabs.get(id)]);
        // The tab's title, as browser.list_tabs names it; Readability's guess (an <h1>, a cut title) only without one.
        const title = tab.title ? markPageData(tab.title) : res.title;
        return { type: 'text', text: text('result.page_text', { url: tab.url ?? '', title, page_markdown: readOn(res.markdown, 'pageText', a.from) }) };
      },
    }),
    readOnTab({
      name: 'browser.find',
      description: 'Finds elements whose role, name or text contain every word of the query, ignoring case and accents. Returns lines with [ref_N].',
      inputSchema: { type: 'object', properties: { ...tabIdProp, query: { type: 'string' } }, required: ['query'] },
      args: (a) => ({ query: String(a.query) }),
      run: async (a, ctx) => {
        const lines = await callPage(targetTab(a, ctx), { op: 'find', query: a.query });
        const found = lines.map((l) => `- ${l}`).join('\n');
        // For a script's tool() (tools/custom/script-tool): each match with its ref.
        const data = lines.map((l) => ({ line: stripMarks(l), ref: /\[(ref_\w+)\]/.exec(stripMarks(l))?.[1] }));
        return { type: 'text', text: lines.length ? text('result.page_read', { tool: 'browser.find', result: found }) : text('result.no_match', { query: a.query }), data };
      },
    }),
    readOnTab({
      name: 'browser.find_in_dom',
      description:
        'Finds elements in the page\'s DOM with a CSS selector, also inside open shadow roots and same-origin iframes (a selector does not cross into them: match the element itself). Returns one line per element with [ref_N], tag, role, accessible name, key attributes, and "hidden" when it is not visible. Prefer it to browser__find when you know or can guess the markup (e.g. input[type=search], [role=combobox], [placeholder*=search i]) or when browser__find found nothing.',
      inputSchema: {
        type: 'object',
        properties: {
          ...tabIdProp,
          selector: { type: 'string', description: 'CSS selector, e.g. "input[type=search]" or "#q, [role=combobox]"' },
          attr: { type: 'string', description: 'Only elements with an attribute whose value (not name) contains this text, ignoring case and accents, e.g. "search"; that attribute is shown. To match by attribute name, use the selector, e.g. "[data-event-type]".' },
        },
        required: ['selector'],
      },
      args: (a) => ({ selector: String(a.selector), attr: optString(a.attr) }),
      run: async (a, ctx) => {
        const res = await callPage(targetTab(a, ctx), { op: 'find-in-dom', selector: a.selector, attr: a.attr || undefined, limit: limit('findInDomMatches') });
        // For a script's tool() (tools/custom/script-tool): each match, its ref and attributes.
        const data = { total: res.total, matches: JSON.parse(stripMarks(JSON.stringify(res.matches))) as typeof res.matches };
        if (!res.lines.length) {
          const none = a.attr ? text('result.dom_no_match_attr', { selector: a.selector, attr: a.attr }) : text('result.dom_no_match', { selector: a.selector });
          return { type: 'text', text: none, data };
        }
        const more = res.total - res.lines.length;
        const found = res.lines.map((l) => `- ${l}`).join('\n') + (more > 0 ? `\n${text('result.dom_more_matches', { count: String(more) })}` : '');
        return { type: 'text', text: text('result.page_read', { tool: 'browser.find_in_dom', result: found }), data };
      },
    }),
    readOnTab({
      name: 'browser.get_html',
      description:
        'Returns the cleaned HTML of the elements matching a CSS selector (scripts, styles and comments removed, long attributes cut). Use it to see a page\'s real markup, e.g. to write a site template\'s selectors; prefer browser__find_in_dom to locate elements.',
      inputSchema: {
        type: 'object',
        properties: {
          ...tabIdProp,
          selector: { type: 'string', description: 'CSS selector, e.g. "ul.products > li:first-child"; defaults to "body"' },
          from: fromParam,
          maxChars: { type: 'number', description: `At most this many characters; defaults to and at most ${htmlChars(undefined)}` },
        },
      },
      args: (a) => ({ selector: optString(a.selector) || 'body', from: optFinite(a.from), maxChars: optFinite(a.maxChars) }),
      run: async (a, ctx) => {
        const max = htmlChars(a.maxChars);
        const res = await callPage(targetTab(a, ctx), { op: 'get-html', selector: a.selector, from: a.from === undefined ? undefined : Math.round(a.from), max });
        if (!res.count) return { type: 'text', text: text('result.dom_no_match', { selector: a.selector }) };
        // Where it was cut, for the views; for the model, where to read on.
        const read = withReadOn({ text: res.text, truncated: res.next < res.total, total: res.total, end: res.next }, 'toolResult');
        return { type: 'text', text: text('result.page_read', { tool: 'browser.get_html', result: read }) };
      },
    }),
    {
      ...onTab,
      name: 'browser.get_structured_data',
      description: 'Structured data of the page: JSON-LD (schema.org), OpenGraph and meta description.',
      inputSchema: { type: 'object', properties: tabIdProp },
      source: 'browser',
      effect: 'read',
      run: async (args, ctx) => {
        const data = await callPage(targetTab(args, ctx), { op: 'structured' });
        return { type: 'text', text: text('result.page_read', { tool: 'browser.get_structured_data', result: truncate(JSON.stringify(data, null, 1), 'structuredData') }) };
      },
    },
    {
      ...onTab,
      name: 'browser.screenshot',
      description: 'Screenshot of the visible part of the active tab. Use it only if you need to see the layout or images.',
      inputSchema: { type: 'object', properties: tabIdProp },
      source: 'browser',
      effect: 'read',
      run: async (args, ctx) => {
        const tab = await browser.tabs.get(targetTab(args, ctx));
        if (!tab.active) throw new Error(text('error.screenshot_not_visible'));
        let dataUrl: string;
        try {
          dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: 'jpeg', quality: SHOT_QUALITY * 100 });
        } catch (e) {
          throw new Error(text('error.screenshot_failed', { error: errorText(e) }));
        }
        const shot = { mediaType: 'image/jpeg', data: dataUrl.slice(dataUrl.indexOf(',') + 1) };
        const sized = await sizedShot(shot);
        return { type: 'image', ...sized };
      },
    },
    readOnTab({
      name: 'browser.wait_for',
      description:
        'Waits until an element is gone or appears (matched like browser__find) and/or an area stops changing (stableMs, e.g. an answer still being written). Use it after starting something slow, instead of reading the page again and again.',
      inputSchema: {
        type: 'object',
        properties: {
          ...tabIdProp,
          gone: { type: 'string', description: 'Words of an element that must disappear, as in browser__find, e.g. "button stop"' },
          appears: { type: 'string', description: 'Words of an element that must appear, as in browser__find' },
          ref: { type: 'string', description: 'Area watched by stableMs and read by returnText, e.g. "ref_k3x_12" (default: the whole page)' },
          stableMs: { type: 'number', description: `Milliseconds the area must go without changing (${DEFAULT_STABLE_MS} when no condition is given)` },
          timeoutSec: { type: 'number', description: `At most this long; defaults to ${DEFAULT_WAIT_SEC}` },
          returnText: { type: 'boolean', description: 'Also return the text of the area once done' },
        },
      },
      args: (a) => ({ gone: optString(a.gone), appears: optString(a.appears), ref: optString(a.ref), stableMs: optFinite(a.stableMs), timeoutSec: optFinite(a.timeoutSec), returnText: optBoolean(a.returnText) }),
      run: async (a, ctx) => {
        const seconds = Math.min(Math.max(1, a.timeoutSec ?? DEFAULT_WAIT_SEC), limit('waitFor'));
        const res = await callPage(targetTab(a, ctx), {
          op: 'wait',
          gone: a.gone || undefined,
          appears: a.appears || undefined,
          ref: a.ref || undefined,
          stableMs: a.stableMs === undefined ? undefined : Math.max(0, a.stableMs),
          timeoutMs: seconds * 1000,
          returnText: a.returnText === true,
          maxChars: pageTextDefault(),
        });
        const took = (res.ms / 1000).toFixed(1);
        // For a script's tool() (tools/custom/script-tool): what was met, and the area's text.
        const met = res.met.map((c) => conditionText(c, true));
        const pending = res.pending.map((c) => conditionText(c, false));
        const data = { done: res.done, met: met.map(stripMarks), pending: pending.map(stripMarks), ...(res.text && { text: stripMarks(res.text.text) }) };
        if (!res.done) return { type: 'text', text: text('result.wait_timeout', { seconds: took, pending: pending.join(', ') }), data };
        const done = text('result.waited', { seconds: took, what: met.join(', ') });
        if (!res.text) return { type: 'text', text: done, data };
        const read = withMarker({ ...res.text, text: markPageData(res.text.text, 'tool') }, 'pageText');
        return { type: 'text', text: `${done}\n${text('result.page_read', { tool: 'browser.wait_for', result: read })}`, data };
      },
    }),
    siteAccessTool(),
  ];
}
