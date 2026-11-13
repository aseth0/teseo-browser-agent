import { useEffect } from 'react';
import { browser, type Browser } from 'wxt/browser';
import { bestEffort } from '../../core/errors';
import { PANEL_HELLO, WINDOW_PANEL_PORT, type WindowPanelState } from '../../core/protocol';
import { onRuntime } from '../../core/runtime';
import { FULL, PREVIEW } from '../../ui/floating-frame';
import { WINDOW_PANEL } from './usePageTarget';

// The window's side panel, where the browser hosts it in a tab (Vivaldi: core/side-panel panelsPerTab),
// tells the background whether it shows (background/panel-windows), so that what opens the chat for
// something leaves it open rather than closing it. Its port closes with it; a worker that has just
// started asks again (PANEL_HELLO). While it shows it says so again every AWAKE_MS, below the worker's
// 30 s idle timeout: a worker woken by a shortcut (a capture's) cannot wait for that answer, and would
// open the panel that shows, which closes it there. Chrome's side panel is in no tab: it says nothing.
// Nor does the chat full screen, or Settings' preview, which are in tabs but no side panel.
const AWAKE_MS = 20_000;

export function usePanelPresence() {
  useEffect(() => {
    if (!WINDOW_PANEL || FULL || PREVIEW) return;
    let port: Browser.runtime.Port | undefined;
    let windowId: number | undefined;
    let gone = false;
    const say = () => {
      if (!port || windowId === undefined) return;
      try {
        port.postMessage({ windowId, shown: document.visibilityState === 'visible' } satisfies WindowPanelState);
      } catch {
        port = undefined; // the worker stopped: it asks again once it starts
      }
    };
    const connect = () => {
      if (gone || windowId === undefined) return;
      port?.disconnect();
      const p = (port = browser.runtime.connect({ name: WINDOW_PANEL_PORT }));
      p.onDisconnect.addListener(() => {
        if (port === p) port = undefined;
      });
      say();
    };
    void bestEffort(
      browser.tabs.getCurrent().then((host) => {
        windowId = host?.windowId;
        connect();
      }),
      'side panel',
    );
    document.addEventListener('visibilitychange', say);
    const awake = setInterval(() => document.visibilityState === 'visible' && say(), AWAKE_MS);
    const offHello = onRuntime(PANEL_HELLO, () => void connect());
    return () => {
      gone = true;
      clearInterval(awake);
      offHello();
      document.removeEventListener('visibilitychange', say);
      port?.disconnect();
    };
  }, []);
}
