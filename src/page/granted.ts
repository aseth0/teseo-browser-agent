// The sites the extension may read, as the user granted them (Settings → Website access).
import { browser } from 'wxt/browser';
import { grantedSites } from './permissions';

// The sites granted one by one.
export async function grantedOneByOne(): Promise<string[]> {
  const { origins = [] } = await browser.permissions.getAll();
  return grantedSites(origins, browser.runtime.getManifest().host_permissions ?? []);
}

// Whether the user granted every site.
export const hasEverySite = (): Promise<boolean> => browser.permissions.contains({ origins: ['<all_urls>'] });

// Every site the extension may read: all of them when the user granted that, else those granted one by one.
export async function readableSites(): Promise<string[]> {
  const { origins = [] } = await browser.permissions.getAll();
  return origins.includes('<all_urls>') ? ['<all_urls>'] : grantedOneByOne();
}
