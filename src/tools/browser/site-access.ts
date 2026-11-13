// browser.site_access: what a site needs to be used as the signed-in user, for making a custom tool
// that sends the browser session (skill create-custom-tool): its cookies' names, and the requests its
// own page makes to its API (method, path, the names of their non-standard headers). Never a value.
// The requests are seen with webRequest while the tab is watched: a few seconds at each call, and a
// while after (the user may use the page meanwhile).
import { tabIdProp, tabOfArgs, targetTab } from './tab-target';
import { browser, type Browser } from 'wxt/browser';
import { markPageData, text } from '../../core/model-texts';
import type { Tool, ToolContext } from '../../core/types';
import { requireAccess } from '../../page/access';
import { argumentDetails } from '../../core/argument-details';

const WATCH_MS = 4000; // watched at each call before answering
const KEEP_MS = 120_000; // and still watched after it
const MAX_REQUESTS = 30;

// Headers every browser sends: not what a site needs.
const STANDARD = new Set([
  'accept', 'accept-encoding', 'accept-language', 'cache-control', 'connection', 'content-length', 'content-type', 'cookie', 'dnt',
  'host', 'if-modified-since', 'if-none-match', 'origin', 'pragma', 'priority', 'range', 'referer', 'te', 'upgrade-insecure-requests', 'user-agent',
]);
const notStandard = (name: string) => !STANDARD.has(name.toLowerCase()) && !/^(sec-|proxy-)/i.test(name);

// A path with its ids made {id}: the same request, whatever the item.
export const pathShape = (path: string) =>
  path.split('/').map((p) => (/^\d+$/.test(p) || /^[a-z0-9_-]{20,}$/i.test(p) || /^[0-9a-f-]{32,36}$/i.test(p) ? '{id}' : p)).join('/');

// The site a host belongs to, roughly: its last two labels (enough to tell the page's API from others).
const siteOf = (host: string) => host.split('.').slice(-2).join('.');

interface Seen {
  method: string;
  host: string;
  path: string;
  headers: Set<string>; // as the page wrote them (the first time)
}

const watched = new Map<number, { seen: Map<string, Seen>; until: number; timer?: ReturnType<typeof setTimeout> }>();

// Watches the tab's requests to its API (fetch and XHR) for KEEP_MS from now.
function watch(tabId: number): Map<string, Seen> {
  let w = watched.get(tabId);
  if (!w) {
    const seen = new Map<string, Seen>();
    const listener = (d: Browser.webRequest.OnSendHeadersDetails) => {
      if (d.type !== 'xmlhttprequest') return;
      const url = new URL(d.url);
      const key = `${d.method} ${url.host}${pathShape(url.pathname)}`;
      if (!seen.has(key) && seen.size >= MAX_REQUESTS) return;
      const s = seen.get(key) ?? { method: d.method, host: url.host, path: pathShape(url.pathname), headers: new Set<string>() };
      for (const h of d.requestHeaders ?? []) if (notStandard(h.name) && ![...s.headers].some((x) => x.toLowerCase() === h.name.toLowerCase())) s.headers.add(h.name);
      seen.set(key, s);
    };
    browser.webRequest.onSendHeaders.addListener(listener, { urls: ['<all_urls>'], tabId }, ['requestHeaders']);
    w = { seen, until: 0 };
    const stop = () => {
      if (Date.now() < w!.until) return void (w!.timer = setTimeout(stop, w!.until - Date.now()));
      browser.webRequest.onSendHeaders.removeListener(listener);
      watched.delete(tabId);
    };
    w.timer = setTimeout(stop, KEEP_MS);
    watched.set(tabId, w);
  }
  w.until = Date.now() + KEEP_MS;
  return w.seen;
}

export function siteAccessTool(): Tool {
  return {
    name: 'browser.site_access',
    description:
      "Lists what a site needs to be used as the signed-in user, from the open tab: its cookies' names, and the requests its own page " +
      'makes to its API (method, path and the names of their non-standard headers). Never any value. Use it before making a custom tool ' +
      "that sends the user's browser session (skill create-custom-tool).",
    inputSchema: { type: 'object', properties: { ...tabIdProp } },
    source: 'browser',
    effect: 'read',
    tabOf: tabOfArgs,
    describe: async (args) => ({ summary: 'See the cookies and request headers a tab\'s site uses (names only)', details: argumentDetails(args) }),
    run: async (args, ctx: ToolContext) => {
      const tabId = targetTab(args, ctx);
      const url = (await browser.tabs.get(tabId)).url ?? '';
      await requireAccess(url);
      const host = new URL(url).host;
      // An extension loaded before it had the permission (not reloaded since) has no cookies API.
      if (!browser.cookies) throw new Error("The extension cannot read cookies yet: reload it (in the browser's extensions page), then try again.");
      const seen = watch(tabId);
      // A while for the page's own requests; stopping the run stops the wait.
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(resolve, WATCH_MS);
        ctx.signal.addEventListener('abort', () => (clearTimeout(timer), reject(ctx.signal.reason)), { once: true });
      });
      const requests = [...seen.values()].filter((s) => siteOf(s.host) === siteOf(host));
      // The cookies of the page's host and of the hosts its API is on.
      const hosts = [...new Set([host, ...requests.map((r) => r.host)])].slice(0, 4);
      const cookies = (await Promise.all(hosts.map((h) => browser.cookies.getAll({ url: `${new URL(url).protocol}//${h}/` })))).flat();
      const cookieList = [...new Map(cookies.map((c) => [c.name, c])).values()].map((c) => `${c.name}${c.httpOnly ? ' (HttpOnly)' : ''}`);
      const requestList = requests.map((r) => `${r.method} ${r.host === host ? '' : `//${r.host}`}${r.path}${r.headers.size ? ` · headers: ${[...r.headers].join(', ')}` : ''}`);
      return {
        type: 'text',
        text: text('result.site_access', {
          host,
          seconds: String(WATCH_MS / 1000),
          cookies: cookieList.length ? markPageData(cookieList.join(', ')) : 'none',
          requests: requestList.length ? markPageData(`\n${requestList.map((r) => `- ${r}`).join('\n')}`) : text('result.site_access_none'),
        }),
      };
    },
  };
}
