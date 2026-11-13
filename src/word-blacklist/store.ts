// Where the word blacklist is kept: when it applies in chrome.storage.local ("wordBlacklist", nothing of
// the terms), the terms and their placeholders in the extension's own IndexedDB (storage/secrets,
// "wordBlacklist"), which no content script can read.
import { browser } from 'wxt/browser';
import { isObject } from '../core/util';
import { storageGet } from '../storage/area';
import { onSecretChanged, readSecret, updateSecret } from '../storage/secrets';
import { watchKey } from '../storage/watch';
import { compileBlacklist, isBlacklistEntry, type Blacklist, type BlacklistConfig, type BlacklistEntry } from './core';

const WORD_BLACKLIST_KEY = 'wordBlacklist';
const SECRET = 'wordBlacklist';

export async function loadBlacklistConfig(): Promise<BlacklistConfig> {
  const stored = await storageGet<BlacklistConfig>('local', WORD_BLACKLIST_KEY);
  return isObject(stored) ? stored : {};
}

export const saveBlacklistConfig = (config: BlacklistConfig) => browser.storage.local.set({ [WORD_BLACKLIST_KEY]: config });

// Only entries with both sides as text: anything else in there is left out.
export async function loadBlacklistEntries(): Promise<BlacklistEntry[]> {
  const stored = await readSecret<unknown>(SECRET);
  return Array.isArray(stored) ? stored.filter(isBlacklistEntry) : [];
}

export const saveBlacklistEntries = (entries: BlacklistEntry[]) =>
  updateSecret<BlacklistEntry[]>(SECRET, (prev) => ({ value: entries.length ? entries : undefined, notify: JSON.stringify(prev ?? []) !== JSON.stringify(entries) }));

// Calls back when either changes, here or in another page.
export function onBlacklistChanged(cb: () => void): () => void {
  const offConfig = watchKey('local', WORD_BLACKLIST_KEY, cb);
  const offEntries = onSecretChanged(SECRET, cb);
  return () => {
    offConfig();
    offEntries();
  };
}

// What a run masks with: none while it is off or has no terms.
export interface BlacklistState {
  config: BlacklistConfig;
  blacklist: Blacklist;
}

export async function loadBlacklist(): Promise<BlacklistState | undefined> {
  const config = await loadBlacklistConfig();
  if (!config.enabled) return undefined;
  const blacklist = compileBlacklist(await loadBlacklistEntries());
  return blacklist.empty ? undefined : { config, blacklist };
}
