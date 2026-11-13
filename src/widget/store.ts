// The page widget's actions (Settings → Actions), and the content script that shows the widget,
// registered on the pages they match (or on every site it may read, Settings → Actions), again
// whenever the actions, the settings, the agents or the sites granted change; then also put into the
// open tabs those changes reach (it skips a tab that already has it).
import { browser } from 'wxt/browser';
import { bestEffort } from '../core/errors';
import { stableJson } from '../core/util';
import { createCollection } from '../storage/collection';
import { fieldsPart, movedFirst, withSecretPart } from '../storage/secret-part';
import { serialized } from '../storage/serial';
import { loadSettings, type Settings } from '../storage/settings';
import { grantedOneByOne, readableSites } from '../page/granted';
import { widgetMatches, type WidgetAction } from './actions';
import { ACTIONS_KEY } from './protocol';
import { widgetSite } from './places';
import { agentStore } from '../agents/profiles';

// What gives an action its reach (the tool it runs and with what, where and when, its prompt, its agent,
// whether it opens the chat) and whether it is on are kept in storage/secrets (storage/secret-part),
// for the action as saved: one a page writes to storage.local, or whose reach it changes there, is
// off. storage.local keeps the action whole, a copy that earlier versions read.
const REACH = ['tool', 'args', 'where', 'when', 'prompt', 'openChat', 'agent'] as const;
const store = withSecretPart(createCollection<WidgetAction>(ACTIONS_KEY, []), {
  secret: 'widgetActions',
  // Without its part kept: as storage.local has it, off.
  ...fieldsPart<WidgetAction, (typeof REACH)[number] | 'enabled'>([...REACH, 'enabled'], (a) => ({ ...a, enabled: false })),
  boundTo: (a) => stableJson(REACH.map((f) => a[f] ?? null)),
});

// Earlier versions kept them only in storage.local: moved once.
export const actionStore = movedFirst(store, 'widgetActions');

const SCRIPT_ID = 'page-widget';
const SCRIPT_FILE = 'page-widget.js';

// Whether the bubble shows on every site the extension may read, actions or not.
export const bubbleEverywhere = (settings: Settings) => settings.pageWidget?.enabled !== false && settings.pageWidget?.everywhere !== false;

// `intoOpenTabs`: put it into the open tabs it matches even when its pages did not change: after the
// extension is reloaded or updated, the copies there are cut off from it (they take themselves away).
// One at a time: the worker's start and a reload's notice both register it, and two at once clash
// ("Duplicate script ID").
const oneByOne = serialized('page-widget-script');
export const syncWidgetScript = (intoOpenTabs = false): Promise<void> => oneByOne(() => syncNow(intoOpenTabs));

const inject = (tabId: number) => bestEffort(browser.scripting.executeScript({ target: { tabId }, files: [`/${SCRIPT_FILE}` as const] }), 'widget-inject');

// Shown again on a site (it was hidden there with its ✕): put into that site's open tabs where it is
// registered. A page there has none of it while it is hidden (entrypoints/page-widget); one that still
// has it (its chat floating) keeps it, the copy put in leaves.
export const wakeWidget = (site: string): Promise<void> =>
  oneByOne(async () => {
    const [script] = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
    if (!site || !script?.matches?.length) return;
    const tabs = await browser.tabs.query({ url: script.matches });
    await Promise.all(tabs.map((t) => t.id !== undefined && widgetSite(t.url) === site && inject(t.id)));
  });

async function syncNow(intoOpenTabs: boolean): Promise<void> {
  const [actions, settings, granted, agents] = await Promise.all([actionStore.load(), loadSettings(), grantedOneByOne(), agentStore.load()]);
  const matches = settings.pageWidget?.enabled === false ? [] : [...new Set([...(bubbleEverywhere(settings) ? await readableSites() : []), ...widgetMatches(actions, granted, agents)])].sort();
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) {
    if (registered.length) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  const before = registered[0]?.matches ?? [];
  const same = matches.join() === [...before].sort().join();
  if (same && !intoOpenTabs) return;
  const script = { id: SCRIPT_ID, matches, js: [SCRIPT_FILE], runAt: 'document_idle' as const, persistAcrossSessions: true };
  if (!same) await (registered.length ? browser.scripting.updateContentScripts([script]) : browser.scripting.registerContentScripts([script]));
  const tabs = await browser.tabs.query({ url: matches });
  await Promise.all(tabs.map((t) => t.id !== undefined && inject(t.id)));
}
