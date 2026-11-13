// The top bar's "DevTools" while the DevTools engine or a recording has the debugger attached (devtools/cdp):
// Vivaldi shows no "debugging this browser" bar, so the chat says it. In every chat view (the side
// panel, the agent manager, the full-screen chat); the icon's DBG badge says it when none is open.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { browser } from 'wxt/browser';
import { DEVTOOLS_STATUS } from '../../core/protocol';
import { onRuntime, sendRuntime } from '../../core/runtime';
import { isExtensionPage } from '../../core/sender';

// The tabs attached now: asked once, then told on every attach and detach.
function useAttachedTabs(): number[] {
  const [tabs, setTabs] = useState<number[]>([]);
  useEffect(() => {
    let live = true;
    sendRuntime({ type: DEVTOOLS_STATUS }).then((r) => live && r && setTabs(r.tabs), () => undefined);
    const off = onRuntime(DEVTOOLS_STATUS, (msg, sender) => {
      if (isExtensionPage(sender) && Array.isArray(msg.tabs)) setTabs(msg.tabs); // another chat's question carries none: left to the background
    });
    return () => {
      live = false;
      off();
    };
  }, []);
  return tabs;
}

export function DevtoolsChip({ topbar }: { topbar?: HTMLElement | null }) {
  const tabs = useAttachedTabs();
  const [titles, setTitles] = useState('');
  useEffect(() => {
    if (!tabs.length) return;
    void Promise.all(tabs.map((id) => browser.tabs.get(id).then((t) => t.title || t.url || `tab ${id}`, () => `tab ${id}`))).then((names) => setTitles(names.join(', ')));
  }, [tabs]);
  if (!topbar || !tabs.length) return null;
  return createPortal(<span className="devtools-on" role="status" title={`Debugger attached to: ${titles}`}>DevTools</span>, topbar);
}
