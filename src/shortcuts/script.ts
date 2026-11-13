// The content script that hears the keys set in Settings → Shortcuts in web pages (entrypoints/page-keys):
// registered on every site the extension may read while a key is set, in every frame (a key pressed in
// one reaches only it), before the page's own scripts; gone when no key is set. Put into the open tabs
// it matches when it is registered anew, or when asked (`intoOpenTabs`: the extension reloaded, the
// copies there cut off from it).
import { browser } from 'wxt/browser';
import { bestEffort } from '../core/errors';
import { readableSites } from '../page/granted';
import { serialized } from '../storage/serial';
import { loadPageKeys, onPageKeysChanged } from './store';

const SCRIPT_ID = 'page-keys';
const SCRIPT_FILE = 'page-keys.js';

// One at a time, as the page widget's (widget/store): two registrations at once clash.
const oneByOne = serialized('page-keys-script');
export const syncPageKeysScript = (intoOpenTabs = false): Promise<void> => oneByOne(() => syncNow(intoOpenTabs));

async function syncNow(intoOpenTabs: boolean): Promise<void> {
  const matches = Object.keys(await loadPageKeys()).length ? (await readableSites()).sort() : [];
  const registered = await browser.scripting.getRegisteredContentScripts({ ids: [SCRIPT_ID] });
  if (!matches.length) {
    if (registered.length) await browser.scripting.unregisterContentScripts({ ids: [SCRIPT_ID] });
    return;
  }
  const same = matches.join() === [...(registered[0]?.matches ?? [])].sort().join();
  if (same && !intoOpenTabs) return;
  const script = { id: SCRIPT_ID, matches, js: [SCRIPT_FILE], runAt: 'document_start' as const, allFrames: true, persistAcrossSessions: true };
  if (!same) await (registered.length ? browser.scripting.updateContentScripts([script]) : browser.scripting.registerContentScripts([script]));
  const tabs = await browser.tabs.query({ url: matches });
  await Promise.all(tabs.map((t) => t.id !== undefined && bestEffort(browser.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: [`/${SCRIPT_FILE}` as const] }), 'page-keys-inject')));
}

// Kept so: when the worker starts, the extension is reloaded or updated, the sites granted change and
// the keys do.
export function keepPageKeysScript() {
  const sync = (intoOpenTabs = false) => void syncPageKeysScript(intoOpenTabs).catch((e: unknown) => console.error('[shortcuts]', e));
  sync();
  browser.runtime.onInstalled.addListener(() => sync(true));
  browser.permissions.onAdded.addListener(() => sync());
  browser.permissions.onRemoved.addListener(() => sync());
  onPageKeysChanged(() => sync());
}
