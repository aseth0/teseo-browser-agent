// The side panel as the chat's pin says (core/side-panel): the browser set for it when the worker
// starts and when the pin changes, its keyboard shortcut, the pin turned on in a tab's panel, and the
// window's panel closed for it where the browser hosts it in a tab.
import { browser } from 'wxt/browser';
import { CLOSE_WINDOW_PANEL, OPEN_WINDOW_PANEL } from '../core/protocol';
import { onRuntime } from '../core/runtime';
import { isExtensionPage } from '../core/sender';
import { PANEL_COMMAND, applyPanelMode, closeWindowPanel, openSidePanel, openWindowPanel } from '../core/side-panel';
import { loadSettings, onSettingsChanged, type Settings } from '../storage/settings';
import { panelFollowsOn } from '../storage/settings-select';
import { tracePanel } from './panel-trace';
import { onShortcut } from './shortcuts';

// The pin as last read, for the clicks that open the panel and cannot wait to read it (widget-host,
// watches). Before the first read (a click that woke the worker): undefined, not known. The panel
// opened then is the window's (core/side-panel), and what is handed to it either panel takes
// (capture/plan chatTarget).
let follows: boolean | undefined;
export const panelFollowsNow = (): boolean | undefined => follows;

// The pin as applied to the browser in this browser session (storage.session: gone with the browser,
// and when the extension reloads). A worker that restarts, woken by a message sent from the panel,
// leaves it as it is: fewer calls, and in Vivaldi turning a tab's panel off closes the window's web
// panel (core/side-panel applyPanelMode turns off only the tabs given one).
const APPLIED_KEY = 'panelModeApplied';

export function listenPanelMode() {
  let applied: Promise<boolean | undefined> = browser.storage.session.get(APPLIED_KEY).then(
    (got) => (typeof got[APPLIED_KEY] === 'boolean' ? got[APPLIED_KEY] : undefined),
    () => undefined,
  );
  const take = (s: Settings) => {
    const want = (follows = panelFollowsOn(s));
    applied = applied.then(async (was) => {
      if (want === was) return was;
      tracePanel({ event: 'apply-mode', follows: want });
      try {
        await applyPanelMode(want);
      } catch (e) {
        console.error('[side panel]', e);
        return undefined; // the next worker tries again
      }
      await browser.storage.session.set({ [APPLIED_KEY]: want }).catch(() => undefined);
      return want;
    });
  };
  loadSettings().then(take, (e: unknown) => console.error('[side panel]', e));
  onSettingsChanged(take);
  // Its shortcut (the toolbar button opens a popup): right away, while the key's gesture lasts.
  onShortcut((command, tab) => {
    if (command === PANEL_COMMAND && tab) void openSidePanel(tab, follows, false, 'shortcut').catch((e: unknown) => console.error('[side panel]', e));
  });
  // The pin turned on in a tab's panel: right away, inside the listener, while the click's gesture lasts.
  onRuntime(OPEN_WINDOW_PANEL, ({ tabId, windowId }, sender) => {
    if (!isExtensionPage(sender)) return;
    return openWindowPanel({ id: tabId, windowId }).then(() => ({ opened: true }), () => ({ opened: false }));
  });
  // Float on this page, from a panel hosted in a tab (Vivaldi): closed here, right away, as the shortcut does.
  onRuntime(CLOSE_WINDOW_PANEL, ({ windowId }, sender) => {
    if (!isExtensionPage(sender)) return;
    return closeWindowPanel(windowId).then(() => ({ closed: true }), () => ({ closed: false }));
  });
}
