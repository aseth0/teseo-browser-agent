// Whether this chat shows, for the background to alert only when it does not (background/session-alerts):
// its page visible (the side panel open, its tab the window's active one, the window not minimized) and,
// floating, its frame on the page (folded, the frame is hidden: the bubble's "!" says it waits). A chat
// of the Agents Panel shows while that panel's tab does: its row's mark says which one waits.
import { browser } from 'wxt/browser';
import type { ChatView } from '../../core/protocol';
import { FLOATING, MANAGER } from '../../ui/floating-frame';

let windowId: number | undefined;
let onPage = true; // floating: its frame not hidden
let started = false;
const listeners = new Set<(v: ChatView) => void>();

export const chatViewNow = (): ChatView => ({
  shown: document.visibilityState === 'visible' && onPage,
  ...(windowId !== undefined && { windowId }),
  ...(MANAGER && { agentsPanel: true }),
});

const changed = () => {
  const v = chatViewNow();
  for (const l of listeners) l(v);
};

function start() {
  if (started) return;
  started = true;
  document.addEventListener('visibilitychange', changed);
  // Where it is, for a notification's click to show it: unknown where this page cannot ask.
  void Promise.resolve()
    .then(() => browser.windows.getCurrent())
    .then((w) => {
      windowId = w.id;
      changed();
    }, () => undefined);
  if (FLOATING && typeof IntersectionObserver === 'function') {
    new IntersectionObserver((entries) => {
      const last = entries[entries.length - 1];
      if (!last || last.isIntersecting === onPage) return;
      onPage = last.isIntersecting;
      changed();
    }).observe(document.documentElement);
  }
}

// Told of each change; returns the removal.
export function watchChatView(onChange: (v: ChatView) => void): () => void {
  start();
  listeners.add(onChange);
  return () => void listeners.delete(onChange);
}
