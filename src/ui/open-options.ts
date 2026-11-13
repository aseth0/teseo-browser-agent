import { browser } from 'wxt/browser';
import { focusTab } from '../browser/open-manager';

// Opens the extension's options page (a full tab with every setting); with a hash, at that
// section or item (e.g. "site-templates/<id>"), reusing the options tab when one is open.
export async function openOptions(hash?: string): Promise<void> {
  if (!hash) return void browser.runtime.openOptionsPage();
  const base = browser.runtime.getURL('/options.html');
  const url = `${base}#${hash}`;
  const [tab] = await browser.tabs.query({ url: `${base}*` });
  if (!tab?.id) return void browser.tabs.create({ url });
  await focusTab({ id: tab.id, windowId: tab.windowId }, url);
}
