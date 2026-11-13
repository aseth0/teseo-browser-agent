// Screenshots into the chat (capture/run): their keyboard shortcuts (the browser's, or keys set in
// Settings: background/shortcuts) and the toolbar popup's buttons (CAPTURE). Each starts right away,
// inside the key's or the click's gesture, which the side panel's opening needs; for a section, the
// page asks for the panel once it is captured (CAPTURE_OPEN_CHAT), inside the drag's.
import { CHAT_ATTACH, captureKindOf } from '../capture/protocol';
import { startCapture, type CaptureDeps } from '../capture/run';
import { CAPTURE, CAPTURE_OPEN_CHAT } from '../core/protocol';
import { onRuntime } from '../core/runtime';
import { isExtensionPage, senderOf } from '../core/sender';
import { openSidePanel } from '../core/side-panel';
import { storageGet } from '../storage/area';
import { floatingNow } from './floating-tabs';
import { panelFollowsNow } from './panel-mode';
import { panelShownIn } from './panel-windows';
import { settingsNow } from './settings';
import { onShortcut } from './shortcuts';

const deps: CaptureDeps = { floatingNow, panelFollowsNow, panelShownIn, settingsNow };

const logged = (p: Promise<unknown>) => void p.catch((e: unknown) => console.error('[capture]', e));

export function hostCapture() {
  onShortcut((command, tab, from) => {
    const kind = captureKindOf(command);
    if (kind && tab?.id !== undefined) logged(startCapture(kind, { id: tab.id, windowId: tab.windowId }, { pageKey: from === 'page' }, deps));
  });
  onRuntime(CAPTURE, ({ kind, tabId, windowId }, sender) => {
    if (!isExtensionPage(sender)) return;
    logged(startCapture(kind, { id: tabId, windowId }, {}, deps));
    return { started: true };
  });
  // Right away, inside the listener. Refused (no gesture left), it counts as opened all the same once a
  // chat took the capture: the side panel was open already.
  onRuntime(CAPTURE_OPEN_CHAT, (_msg, sender) => {
    const tab = sender.tab;
    if (!senderOf(sender).fromPage || tab?.id === undefined) return;
    return openSidePanel(tab, panelFollowsNow(), panelShownIn(tab.windowId), 'capture-open-chat').then(
      () => ({ opened: true }),
      async () => ({ opened: (await storageGet<unknown>('session', CHAT_ATTACH)) === undefined }),
    );
  });
}
