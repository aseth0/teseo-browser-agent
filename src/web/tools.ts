// Tools to search and read the web through the user's own browser, without touching their tabs.
// web.search runs the browser's search engine (chrome.search, or the search URL in Settings → Web
// search) in a background tab and reads the results with the engine's site template
// (templates/*-search), or the page's text when no template knows it. web.read reads any page in a
// background tab. web.show_user opens a page in front of the user instead. What they return is page
// content: untrusted. Both open a URL the model chose, with the user's session: like browser.navigate,
// they are actions judged by the site policy of that URL (a page could otherwise have the model
// send what it read to any address, or fetch one with the user's cookies).
import { browser } from 'wxt/browser';
import { limit, pageTextDefault } from '../core/limits';
import { readOn, text, withMarker } from '../core/model-texts';
import type { Tool, ToolContext, ToolResult } from '../core/types';
import { runPageTemplates, runView } from '../templates/run';
import { requireAccess } from '../page/access';
import { inBackgroundTab, LOAD_TIMEOUT_MS } from '../page/background-tab';
import { callPage, isNavigationError, waitForLoad } from '../page/bridge';
import { hostOf, sleep } from '../core/util';
import type { WebSearchSettings } from '../storage/settings-types';
import { pageTextChars } from '../tools/browser/read-tools';
import { pickView, templateFound, templateItems, templateOutput, templatesFor } from '../templates/render';
import { templateStore } from '../templates/store';
import type { PageTemplate } from '../templates/types';
import { countArg, defineTool, fields, optFinite, optNumber } from '../tools/define';
import { fromParam } from '../tools/read-more';
import { DEFAULT_RESULTS, firstResults, MAX_RESULTS, searchUrl } from './results';

const SETTLE_MS = 1500; // a page without a template to wait on: time for its scripts to show it
const RESULTS_WAIT_MS = 8000; // how long the results are waited for (they may come after the page loads)

// What a search engine shows a robot instead of results: its URL, or what is on the page.
const BLOCKED_URL = /\/sorry\/|captcha|blocked|consent\./i;
const BLOCKED_SELECTOR = '[data-testid="anomaly-modal"], #challenge-form, form[action*="anomaly"], #captcha-form, form[action*="captcha"], iframe[src*="captcha"], iframe[src*="challenge"]';
const BLOCK_CHECK: PageTemplate = {
  id: 'web-blocked',
  name: 'web-blocked',
  description: '',
  matches: [],
  enabled: true,
  views: [{ name: 'check', paths: [], replacePage: false, body: `{{ page | one: '${BLOCKED_SELECTOR}' }}` }],
};

const engineOf = (url: string) => hostOf(url).replace(/^www\./, '');

// Until the tab has left about:blank and loaded where it went.
async function waitForNavigation(tabId: number): Promise<string> {
  const deadline = Date.now() + LOAD_TIMEOUT_MS;
  for (;;) {
    const tab = await browser.tabs.get(tabId);
    const url = tab.url ?? '';
    if ((url && !url.startsWith('about:') && tab.status === 'complete') || Date.now() >= deadline) return url;
    await sleep(100);
  }
}

// The results as the engine's site template reads them, once it finds them; or the engine blocked
// the search; or neither, once the time is up (or at once, when no template knows the engine).
async function waitForResults(tabId: number, url: string): Promise<{ output?: string; blocked?: boolean }> {
  const views = templatesFor(await templateStore.load(), url).flatMap((t) => {
    const picked = pickView(t, url);
    return picked ? [{ t, view: picked.view.name }] : [];
  });
  const deadline = Date.now() + RESULTS_WAIT_MS;
  for (;;) {
    for (const { t, view } of views) {
      const run = await runView(tabId, t, view);
      if (templateFound(run)) return { output: templateOutput(run) };
    }
    if (BLOCKED_URL.test(url) || templateFound(await runView(tabId, BLOCK_CHECK, 'check'))) return { blocked: true };
    if (!views.length || Date.now() >= deadline) return {};
    await sleep(1000);
  }
}

async function search(query: string, n: number, settings: WebSearchSettings, agentTab: number | undefined): Promise<ToolResult> {
  return inBackgroundTab(settings.engineUrl ? searchUrl(settings.engineUrl, query) : 'about:blank', { web: settings, agentTab }, async (tabId) => {
    if (!settings.engineUrl) await browser.search.query({ text: query, tabId });
    const url = await waitForNavigation(tabId);
    const engine = engineOf(url);
    await requireAccess(url);
    const { output, blocked } = await waitForResults(tabId, url);
    if (blocked) return { type: 'text', text: text('result.web_blocked', { engine, url }), isError: true };
    if (output !== undefined) {
      const { results, count } = firstResults(output, n);
      return { type: 'text', text: count ? text('result.web_results', { query, engine, results }) : text('result.web_no_results', { query, engine }) };
    }
    // No template knows this engine, or it found nothing: the page as text.
    await sleep(SETTLE_MS);
    const page = await callPage(tabId, { op: 'text', maxChars: pageTextDefault() });
    return { type: 'text', text: text('result.web_results', { query, engine, results: withMarker(page.markdown, 'pageText') }) };
  });
}

const notWeb = (url: string): ToolResult | undefined =>
  /^https?:\/\//i.test(url) ? undefined : { type: 'text', text: `Only http(s) URLs can be opened, not "${url}".`, isError: true };

const MAX_SIGN_IN_ASKS = 3; // the user said they signed in, and the page still asks: asked again, then left

// Whether the page asks to sign in. One that is still navigating (a redirect to a sign-in page, say)
// is asked again once it has loaded; any other failure is the read's (no access, a page that does
// not answer), not a page without a sign-in form.
export async function signInAsked(ask: () => Promise<boolean>, settle: () => Promise<void>): Promise<boolean> {
  try {
    return await ask();
  } catch (e) {
    if (!isNavigationError(e)) throw e;
  }
  await settle();
  try {
    return await ask();
  } catch (e) {
    if (isNavigationError(e)) return false; // still moving: the read that follows says what is there
    throw e;
  }
}

// A page by its URL, in a background tab. A site template of its site that is to be used for it
// (PageTemplate.webRead) reads it there: what it extracts, when it finds something, in place of the
// page's text. One that asks to sign in waits for the user to sign in in its tab.
async function read({ url, from, maxChars }: { url: string; from?: number; maxChars?: number }, ctx: ToolContext): Promise<ToolResult> {
  const refused = notWeb(url);
  if (refused) return refused;
  await requireAccess(url);
  const template = templatesFor(await templateStore.load(), url).find((t) => t.webRead && pickView(t, url));
  const read = await inBackgroundTab(url, { web: ctx.settings.webSearch, agentTab: ctx.tabId }, async (tabId): Promise<ToolResult | { elsewhere: string }> => {
    const settle = async () => {
      await waitForLoad(tabId, LOAD_TIMEOUT_MS);
      await sleep(SETTLE_MS);
    };
    await settle();
    // A page that asks to sign in: its tab stays open while the user signs in there, then it is read.
    for (let asked = 0; await signInAsked(() => callPage(tabId, { op: 'sign-in' }), settle); asked++) {
      const at = (await browser.tabs.get(tabId)).url ?? url;
      const reply = asked < MAX_SIGN_IN_ASKS && ctx.interact ? await ctx.interact({ kind: 'sign-in', url: at, tabId }, ctx.signal) : { dismissed: true as const };
      if ('dismissed' in reply) return { type: 'text', text: text('result.web_sign_in', { url: at }) };
      await settle();
    }
    const at = (await browser.tabs.get(tabId)).url ?? url; // where it ended up (redirects)
    // Redirected to another site (or from https to http): its page is not read here, under the
    // requested site's policy and access; the tab is closed first.
    if (siteOf(at) !== siteOf(url)) return { elsewhere: at };
    if (template) {
      const results = await runPageTemplates(tabId, [template], at);
      const result = results[template.id];
      const { items } = templateItems([template], results);
      if (result?.view && templateFound(result.run) && items[0]) return { type: 'text', text: items[0].text };
    }
    const page = await callPage(tabId, { op: 'text', maxChars: pageTextChars(maxChars), from });
    return { type: 'text', text: text('result.web_read', { url: at, title: page.title, page_markdown: readOn(page.markdown, 'pageText', from) }) };
  });
  if (!('elsewhere' in read)) return read;
  // The page it went to, read as a call of its own: judged by that site's policy and access, as the
  // model's calls are (asked, refused or allowed). A call run that way has no callTool of its own, so
  // a page that redirects again to another site is not read.
  const elsewhere = read.elsewhere;
  if (!ctx.callTool) return { type: 'text', text: `${url} redirected to ${elsewhere}, another site: it was not read.`, isError: true };
  const answer = await ctx.callTool('web.read', { url: elsewhere, ...(maxChars !== undefined && { maxChars }), ...(from !== undefined && { from }) });
  return { type: 'text', text: answer.content, ...(answer.isError && { isError: true }) };
}

// The scheme and host of a URL: what a page read must stay on for the policy it was allowed by.
function siteOf(url: string): string {
  try {
    const { protocol, host } = new URL(url);
    return `${protocol}//${host}`;
  } catch {
    return url;
  }
}

// As browser__get_page_text's, with the limits as they are now.
const maxCharsParam = {
  type: 'number',
  get description() {
    return `At most this many characters; defaults to ${pageTextDefault()}, at most ${limit('pageTextMax')}`;
  },
} as const;

export function webTools(): Tool[] {
  const url = (raw: unknown) => ({ url: String(fields(raw).url) });
  return [
    defineTool({
      name: 'web.search',
      description:
        "Searches the web with the browser's search engine and lists the results (title, URL, snippet). " +
        'Use it for current facts or things not on the open page; then read a result with web__read.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string' },
          limit: { type: 'number', description: `How many results (at most ${MAX_RESULTS})` },
        },
        required: ['query'],
      },
      source: 'web',
      effect: 'read',
      // The engine is the user's (the browser's, or Settings → Web search), not judged by the open
      // tab's site: an agent searches from any page. What it then reads (web.read) is held to its sites.
      siteless: true,
      args: (raw) => ({ query: String(fields(raw).query), limit: optNumber(fields(raw).limit) }),
      describe: async ({ query }) => ({ summary: `Search the web for "${query}"` }),
      run: async ({ query, limit: asked }, ctx) => {
        const settings = ctx.settings.webSearch ?? {};
        const n = countArg(asked, settings.results ?? DEFAULT_RESULTS, MAX_RESULTS);
        return search(query, n, settings, ctx.tabId);
      },
    }),
    defineTool({
      name: 'web.read',
      description:
        'Reads a web page by its URL, as readable text (Markdown). It opens the page in a background tab of its own ' +
        "(in the agent's window, muted, never focused) and closes it when done; the user's own tabs are not touched.",
      inputSchema: { type: 'object', properties: { url: { type: 'string' }, maxChars: maxCharsParam, from: fromParam }, required: ['url'] },
      source: 'web',
      effect: 'write',
      repeatable: true, // a page read again is the same read: its left-out result may be fetched again
      args: (raw) => ({ ...url(raw), maxChars: optFinite(fields(raw).maxChars), from: optFinite(fields(raw).from) }),
      describe: async (a) => ({ summary: `Read ${a.url} in a background tab`, url: a.url }),
      run: read,
    }),
    defineTool({
      name: 'web.show_user',
      description:
        'Opens a web page in a new tab in front of the user, for them to see it (e.g. a search result they asked for). ' +
        'It does not read the page: use web__read for that. Use it only when the user wants to see the page.',
      inputSchema: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
      source: 'web',
      effect: 'write',
      args: url,
      describe: async (a) => ({ summary: `Open ${a.url} in a new tab`, url: a.url }),
      run: async ({ url }, ctx) => {
        const refused = notWeb(url);
        if (refused) return refused;
        // Next to the panel's tab, in its window.
        const current = ctx.tabId === undefined ? undefined : await browser.tabs.get(ctx.tabId).catch(() => undefined);
        await browser.tabs.create({ url, active: true, ...(current && { windowId: current.windowId, index: current.index + 1 }) });
        return { type: 'text', text: text('result.web_shown', { url }) };
      },
    }),
  ];
}

// web.search confirmed every time (Settings → Web search → Ask before each search).
export const askingFirst = (t: Tool): Tool => ({ ...t, alwaysAsk: true });
