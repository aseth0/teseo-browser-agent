// The windows whose side panel shows now, where the browser hosts it in a tab (Vivaldi: core/side-panel
// panelsPerTab). There sidePanel.open toggles: on the panel that shows, it closes it. So what opens the
// chat for something (a recording's review, a screenshot, the bubble) leaves that one open and hands
// over to it, which a click allows only if known at once. Each such panel says whether it shows on its
// port (WINDOW_PANEL_PORT, sidepanel/usePanelPresence), again while it shows so that the worker stays
// awake and keeps knowing, and its port closes when it goes. A worker that
// has just started asks them again (PANEL_HELLO): until they answer it knows none. The popup asks before
// any click (PANEL_SHOWN), so that answer waits for them, up to HELLO_MS; what opens inside a click
// cannot wait (core/side-panel: nothing awaited before open) and knows none until then. Chrome's panels
// never connect: there opening one that is open changes nothing.
import { browser, type Browser } from 'wxt/browser';
import { PANEL_HELLO, PANEL_SHOWN, WINDOW_PANEL_PORT, type WindowPanelState } from '../core/protocol';
import { onRuntime, sendRuntime } from '../core/runtime';
import { isExtensionPage } from '../core/sender';
import { tracePanelCalls } from '../core/side-panel';
import { sleep } from '../core/util';
import { tracePanel } from './panel-trace';

const HELLO_MS = 100; // how long the panels get to answer the hello
const panels = new Map<Browser.runtime.Port, WindowPanelState>();
let hello: Promise<void> | undefined; // the hello's round-trip, while it is still under way

export const panelShownIn = (windowId: number) => [...panels.values()].some((p) => p.windowId === windowId && p.shown);
const shownWindows = () => [...new Set([...panels.values()].filter((p) => p.shown).map((p) => p.windowId))];

const isState = (m: unknown): m is WindowPanelState => {
  const s = m as Partial<WindowPanelState> | undefined;
  return Number.isInteger(s?.windowId) && typeof s?.shown === 'boolean';
};

export function listenPanelWindows() {
  // For the next time a panel closes unasked (background/panel-trace): what the worker knew at each open.
  tracePanel({ event: 'worker-start' });
  tracePanelCalls((c) => tracePanel({ event: 'call', ...c, shownIn: shownWindows(), hello: hello !== undefined }));
  browser.runtime.onConnect.addListener((port) => {
    if (port.name !== WINDOW_PANEL_PORT) return;
    if (!isExtensionPage(port.sender)) return port.disconnect();
    port.onMessage.addListener((msg: unknown) => {
      if (!isState(msg)) return;
      const before = panels.get(port);
      panels.set(port, { windowId: msg.windowId, shown: msg.shown });
      if (before?.windowId !== msg.windowId || before.shown !== msg.shown) tracePanel({ event: 'panel', windowId: msg.windowId, shown: msg.shown });
    });
    port.onDisconnect.addListener(() => {
      const gone = panels.get(port);
      panels.delete(port);
      if (gone) tracePanel({ event: 'panel-gone', windowId: gone.windowId });
    });
  });
  onRuntime(PANEL_SHOWN, ({ windowId }, sender) => {
    if (!isExtensionPage(sender)) return;
    const answer = () => ({ shown: panelShownIn(windowId) });
    return hello ? hello.then(answer) : answer();
  });
  // Rejected: no page open, nobody to answer, nothing to wait for.
  hello = sendRuntime({ type: PANEL_HELLO }).then(() => sleep(HELLO_MS), () => undefined).then(() => void (hello = undefined));
}
