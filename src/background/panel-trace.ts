// A trace of what the side panel went through, for when it closes unasked: where the browser hosts it in
// a tab (Vivaldi), opening it while it shows closes it (background/panel-windows). Kept: the worker's
// starts, the runs, each window panel's state and its port going, and each open or close the background
// asks for, with what asked and what it knew then. Only the last PANEL_TRACE_MAX, in storage.session
// (gone with the browser; no page's script reads it). Read it in the service worker's console:
// chrome.storage.session.get('panelTrace').
import { browser } from 'wxt/browser';

export const PANEL_TRACE_KEY = 'panelTrace';
export const PANEL_TRACE_MAX = 50;

let writes: Promise<void> = Promise.resolve();

// One at a time, in order; one that cannot be written is left out.
export function tracePanel(entry: { event: string } & Record<string, unknown>): void {
  const line = { at: new Date().toISOString(), ...entry };
  writes = writes
    .then(async () => {
      const got = (await browser.storage.session.get(PANEL_TRACE_KEY))[PANEL_TRACE_KEY];
      const before = Array.isArray(got) ? got : [];
      await browser.storage.session.set({ [PANEL_TRACE_KEY]: [...before, line].slice(-PANEL_TRACE_MAX) });
    })
    .catch(() => undefined);
}

// Once what was traced so far is written (for the tests).
export const panelTraced = (): Promise<void> => writes;
