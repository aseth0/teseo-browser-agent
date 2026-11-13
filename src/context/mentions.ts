// Reads the site mentions of a message (templates/mentions) for the background: each from a tab of
// its site (the active one, another open one, or its fixed URL opened in a background tab and closed),
// asking the user for access to the site when needed.
import { browser } from 'wxt/browser';
import { limit } from '../core/limits';
import type { ContextItem } from '../core/messages';
import type { AccessRequest } from '../core/types';
import { accessRequest, hasAccess } from '../page/access';
import { type BackgroundTabOptions, inBackgroundTab, LOAD_TIMEOUT_MS } from '../page/background-tab';
import { waitForLoad } from '../page/bridge';
import { isRestrictedUrl } from '../page/permissions';
import type { TemplateRun } from '../templates/liquid';
import { sleep } from '../core/util';
import { MENTION_FAILED_SOURCE, MENTION_SOURCE } from './sources';
import { fixedUrl, mentionFailed, mentionMessage, pickTab, sentMentions, type Mention, type MentionSource } from '../templates/mentions';
import { pickView, templateFound, urlPath } from '../templates/render';
import type { PageTemplate, TemplateView } from '../templates/types';
import { runView } from '../templates/run';
import { errorText } from '../core/errors';
import type { WebSearchSettings } from '../storage/settings-types';

// How long a background tab is given to show what the view reads, after it loads.
const BACKGROUND_WAIT_MS = 8000;

interface MentionDeps {
  activeTabId?: number;
  web?: WebSearchSettings; // how a background tab opens (Settings → Web search)
  requestAccess: (access: AccessRequest) => Promise<boolean>;
  onStatus: (text: string) => void; // e.g. "Reading ::todoist/today…"
}

// The context items of the mentions, the sites read from the active tab (not applied again on
// their own), and the one whose data replaces the page's visible elements.
interface MentionResult {
  items: ContextItem[];
  fromActiveTab: Set<string>; // template ids
  replacedBy?: string;
}

export async function readMentions(mentions: Mention[], deps: MentionDeps): Promise<MentionResult> {
  const result: MentionResult = { items: [], fromActiveTab: new Set() };
  for (const m of sentMentions(mentions)) {
    // Read ones carry their name as source (the panel shows them as chips); failed ones do not.
    const failed = (reason: string) => result.items.push({ kind: 'page', text: mentionFailed(m.name, reason), source: MENTION_FAILED_SOURCE + m.name });
    if (m.problem) {
      failed(failure(m));
      continue;
    }
    deps.onStatus(`Reading ::${m.name}…`);
    const read = await readMention(m.template!, m.view, deps).catch((e: unknown) => errorText(e));
    if (typeof read === 'string') {
      failed(read);
      continue;
    }
    result.items.push({ kind: 'page', text: mentionMessage(m.site, read.view.name, read.run, read.from), source: MENTION_SOURCE + m.name });
    if (read.from.kind === 'active') {
      result.fromActiveTab.add(m.template!.id);
      if (read.view.replacePage && templateFound(read.run)) result.replacedBy ??= m.site;
    }
  }
  return result;
}

const failure = (m: Mention) =>
  m.problem === 'no-view' ? `the template "${m.site}" has no view "${m.view}"` : `only ${limit('mentions')} mentions are read per message`;

// One mention: the tab, the view for it, and its run. Throws why it cannot be read.
async function readMention(t: PageTemplate, viewName: string | undefined, deps: MentionDeps): Promise<{ view: TemplateView; run: TemplateRun; from: MentionSource }> {
  const named = viewName === undefined ? undefined : t.views.find((v) => v.name === viewName);
  const tab = pickTab(t, await browser.tabs.query({ windowType: 'normal' }), deps.activeTabId, named);
  if (tab?.id !== undefined && tab.url) {
    const view = named ?? pickView(t, tab.url)?.view;
    if (!view) throw new Error(`no view of ${t.name} matches ${urlPath(tab.url)}`);
    await ensureAccess(tab.url, tab.title, deps);
    return { view, run: await runView(tab.id, t, view.name), from: { kind: tab.id === deps.activeTabId ? 'active' : 'open', tabId: tab.id } };
  }
  // No tab of the site: the view's fixed URL (without a view named: the first view that has one).
  const view = named ?? t.views.find((v) => fixedUrl(t, v));
  const url = view && fixedUrl(t, view);
  if (!view || !url) {
    throw new Error(`no tab of ${t.name} is open, and ${viewName ? `the view "${viewName}" has` : 'it has no view with'} no fixed URL to open`);
  }
  await ensureAccess(url, undefined, deps);
  return { view, run: await readInBackground(t, view, url, { web: deps.web, agentTab: deps.activeTabId }), from: { kind: 'background', url } };
}

async function ensureAccess(url: string, title: string | undefined, deps: MentionDeps): Promise<void> {
  if (isRestrictedUrl(url)) throw new Error(`the browser does not allow reading ${url}`);
  if (await hasAccess(url)) return;
  const access = accessRequest(url, title);
  if (!(await deps.requestAccess(access))) throw new Error(`the user did not allow reading ${access.site}`);
}

// Opens the URL in a background tab, runs the view until it finds something (or the time is up),
// and closes the tab.
const readInBackground = (t: PageTemplate, view: TemplateView, url: string, options: BackgroundTabOptions): Promise<TemplateRun> =>
  inBackgroundTab(url, options, async (tabId) => {
    await waitForLoad(tabId, LOAD_TIMEOUT_MS);
    const deadline = Date.now() + BACKGROUND_WAIT_MS;
    for (;;) {
      const run = await runView(tabId, t, view.name);
      if (run.error || templateFound(run) || Date.now() >= deadline) return run;
      await sleep(1000);
    }
  });
