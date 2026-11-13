// The extension's commands, run by their browser shortcut (manifest commands) or by a key set in
// Settings → Shortcuts (shortcuts/keys), pressed in a page (PAGE_KEY from entrypoints/page-keys) or in
// one of the extension's own pages. Each runs right away, inside the key press, whose gesture opening
// the side panel needs.
import { browser, type Browser } from 'wxt/browser';
import { PAGE_KEY } from '../core/protocol';
import { onRuntime } from '../core/runtime';
import { isExtensionPage } from '../core/sender';
import { PANEL_COMMAND } from '../core/side-panel';
import type { PageKeys } from '../shortcuts/keys';
import { loadPageKeys, onPageKeysChanged } from '../shortcuts/store';

type Tab = { id?: number; windowId: number };
// `from`: the browser's shortcut, or a key set here.
export type ShortcutListener = (command: string, tab: Tab | undefined, from: 'browser' | 'page') => void;

const listeners: ShortcutListener[] = [];

export function onShortcut(listener: ShortcutListener) {
  browser.commands.onCommand.addListener((command, tab) => listener(command, tab, 'browser'));
  listeners.push(listener);
}

// The toolbar button's command opens its popup, which nothing but the browser can do from a key.
const isCommand = (command: string) => command !== '_execute_action' && Object.hasOwn(browser.runtime.getManifest().commands ?? {}, command);

export function listenPageKeys() {
  const run = (command: string, tab: Tab) => listeners.forEach((l) => l(command, tab, 'page'));
  // Only the commands a key is set for here (a page's script could name any): kept at hand, so that the
  // check is inside the key press; read first when the worker has just started for this very key.
  let keys: PageKeys | undefined;
  onPageKeysChanged((set) => (keys = set));
  const loaded = loadPageKeys().then(
    (set) => (keys ??= set),
    (): PageKeys => ({}),
  );
  const isBound = (set: PageKeys, command: string) => Object.hasOwn(set, command);
  const dispatch = (command: string, sender: Browser.runtime.MessageSender) => {
    const tab = sender.tab;
    // A page's own tab, at once.
    if (!isExtensionPage(sender)) {
      if (tab?.id !== undefined) run(command, { id: tab.id, windowId: tab.windowId });
      return;
    }
    // The extension's pages: the side panel in their window, at once (none for the side panel itself);
    // the rest on the active tab, as the browser's shortcut runs them.
    if (command === PANEL_COMMAND) {
      if (tab?.id !== undefined) run(command, { id: tab.id, windowId: tab.windowId });
      return;
    }
    void browser.tabs.query({ active: true, lastFocusedWindow: true }).then(
      ([active]) => active && run(command, { id: active.id, windowId: active.windowId }),
      (e: unknown) => console.error('[shortcuts]', e),
    );
  };
  onRuntime(PAGE_KEY, ({ command }, sender) => {
    if (!isCommand(command)) return;
    if (keys) {
      if (isBound(keys, command)) dispatch(command, sender);
      return;
    }
    void loaded.then((set) => isBound(set, command) && dispatch(command, sender));
  });
}
