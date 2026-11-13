// The extension's keyboard shortcuts (manifest commands) as the browser has them set: the user sets them
// on its extension shortcuts page, which no API can change. Read again when the page shows again, back
// from setting them there. And the keys set in Settings → Shortcuts for the same commands (shortcuts/keys).
import { useLive, useReload } from './useLive';
import { browser } from 'wxt/browser';
import type { KeyCombo, PageKeys } from '../shortcuts/keys';
import { loadPageKeys, onPageKeysChanged, savePageKeys } from '../shortcuts/store';
import { hasEverySite } from '../page/granted';

const NO_KEYS: PageKeys = {};

export type Shortcut = { name: string; description: string; shortcut: string };

export function useShortcuts(): Shortcut[] {
  return useReload(readShortcuts, onShown, NO_SHORTCUTS, '[shortcuts]');
}
const NO_SHORTCUTS: Shortcut[] = [];
const readShortcuts = async () => (await browser.commands.getAll()).map((c) => ({ name: c.name ?? '', description: c.description ?? '', shortcut: c.shortcut ?? '' }));
const onShown = (again: () => void) => {
  const onShow = () => document.visibilityState === 'visible' && again();
  document.addEventListener('visibilitychange', onShow);
  return () => document.removeEventListener('visibilitychange', onShow);
};

export const shortcutOf = (all: Shortcut[], name: string) => all.find((c) => c.name === name)?.shortcut ?? '';

// "Visible (Alt+Shift+S)", or the name alone with no key set.
export const withShortcut = (name: string, key?: string) => (key ? `${name} (${key})` : name);

// The browser's page that sets them (Vivaldi serves chrome:// pages as its own).
export const openShortcutsPage = () => browser.tabs.create({ url: 'chrome://extensions/shortcuts' }).then(() => undefined);

// Keys shown as macOS shows them there, else as the browser writes its shortcuts.
export const isMac = () => /Mac/i.test(navigator.userAgent);

// The keys set here, as stored (also when another page changes them), and setting or clearing one.
// The key shows once it is saved; the save's failure goes to the caller.
export function usePageKeys(): [PageKeys, (name: string, combo: KeyCombo | undefined) => Promise<void>] {
  const keys = useLive(loadPageKeys, onPageKeysChanged, NO_KEYS, '[page keys]');
  const set = (name: string, combo: KeyCombo | undefined) => {
    const { [name]: _, ...rest } = keys;
    return savePageKeys(combo ? { ...rest, [name]: combo } : rest);
  };
  return [keys, set];
}

// Whether the extension may read every site (Settings → Website access), as it changes.
export const useEverySite = (): boolean => useReload(hasEverySite, onPermissions, false, '[every site]');
const onPermissions = (again: () => void) => {
  browser.permissions.onAdded.addListener(again);
  browser.permissions.onRemoved.addListener(again);
  return () => {
    browser.permissions.onAdded.removeListener(again);
    browser.permissions.onRemoved.removeListener(again);
  };
};
