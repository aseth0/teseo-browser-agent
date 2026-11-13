import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { onPermissionsChanged } from '../../ui/permissions-changed';
import { browser } from 'wxt/browser';
import { bestEffort } from '../../core/errors';
import { pageAccess, type PageAccess } from '../../page/access';
import { isRestrictedUrl, originPattern } from '../../page/permissions';
import { FLOATING, floatingTab } from '../../ui/floating-frame';
import { panelTabOf } from '../../core/side-panel';
import { activeTab } from '../../ui/active-tab';
import { useStableCallback } from '../../ui/useStableCallback';

export interface PageTarget {
  tabId?: number;
  url?: string;
  title?: string;
  windowId?: number;
  access: PageAccess | 'none';
  // The tab you are on, when it is not the one the chat works on (it is bound to another): the one
  // "Use this tab" moves it to.
  elsewhere?: { tabId: number; title?: string; url?: string };
  // The chat works on that tab from then on (the page bar's tab picker): the window's side panel and full screen.
  bindTo?: (tabId: number) => void;
  grant: () => Promise<void>;
}

// The tab this side panel is opened on, when it is one tab's (the chat's pin off: core/side-panel).
export const PANEL_TAB = FLOATING ? undefined : panelTabOf(location.search);
// This chat is the window's side panel (the pin on), not a tab's own or floating.
export const WINDOW_PANEL = !FLOATING && PANEL_TAB === undefined;

// Floating on a page: that page; a tab's own side panel: that tab. Else the tab you are on, or `bound`,
// the tab the conversation works on, wherever you are (`elsewhere`: the one you are on), unless it was
// closed (`gone`: the tab you are on, then).
async function findTarget(bound: number | undefined) {
  if (FLOATING) return { tab: await floatingTab() };
  if (PANEL_TAB !== undefined) return { tab: await browser.tabs.get(PANEL_TAB).catch(() => undefined) };
  const active = await activeTab();
  if (bound === undefined || bound === active?.id) return { tab: active };
  const tab = await browser.tabs.get(bound).catch(() => undefined);
  return tab ? { tab, elsewhere: active } : { tab: active, gone: true };
}

// The page the chat works on. `bound` (the window's side panel only): the tab its conversation is
// bound to, kept while you go to other tabs; `onGone`: that tab was closed.
export function usePageTarget(bound?: number, onGone?: () => void): PageTarget {
  const closed = useStableCallback(() => onGone?.());
  const [state, setState] = useState<Omit<PageTarget, 'grant'>>({ access: 'none' });

  // Which ask is the latest: a slower earlier one (another tab, before a switch) is dropped.
  const asked = useRef(0);
  const refresh = useCallback(async () => {
    const ask = ++asked.current;
    const { tab, elsewhere, gone } = await findTarget(bound);
    if (ask !== asked.current) return;
    if (gone) closed();
    if (!tab?.id) return setState((prev) => (prev.access === 'none' && prev.tabId === undefined ? prev : { access: 'none' }));
    const access = await pageAccess(tab.url);
    if (ask !== asked.current) return;
    const next = { tabId: tab.id, url: tab.url, title: tab.title, windowId: tab.windowId, access, ...(elsewhere?.id !== undefined && { elsewhere: { tabId: elsewhere.id, title: elsewhere.title, url: elsewhere.url } }) };
    // Any tab that finishes loading asks again: keep the same state when nothing changed.
    setState((prev) => (JSON.stringify(prev) === JSON.stringify(next) ? prev : next));
  }, [bound, closed]);

  useEffect(() => {
    const again = () => void bestEffort(refresh(), 'page-target'); // a tab closed meanwhile: the next event asks again
    again();
    const onUpdated = (_id: number, info: { url?: string; status?: string }) => {
      if (info.url || info.status === 'complete') again();
    };
    browser.tabs.onActivated.addListener(again);
    browser.tabs.onUpdated.addListener(onUpdated);
    browser.windows.onFocusChanged.addListener(again);
    browser.tabs.onRemoved.addListener(again); // the bound tab, closed while you were on another
    const offPermissions = onPermissionsChanged(again);
    return () => {
      browser.tabs.onActivated.removeListener(again);
      browser.tabs.onUpdated.removeListener(onUpdated);
      browser.windows.onFocusChanged.removeListener(again);
      browser.tabs.onRemoved.removeListener(again);
      offPermissions();
    };
  }, [refresh]);

  // Must be called from a click (user gesture).
  const grant = useCallback(async () => {
    if (!state.url || isRestrictedUrl(state.url)) return;
    await browser.permissions.request({ origins: [originPattern(state.url)] });
    await refresh();
  }, [state.url, refresh]);

  // The same object while the page stays: the chat's memoized parts take it.
  return useMemo(() => ({ ...state, grant }), [state, grant]);
}

// The chat's page. In the window's side panel, the tab its conversation works on: the one its first
// turn ran on, kept as you go to other tabs, until another is chosen (bindTo: the tab picker, "Use this
// tab") or `onGone`, it was closed. None yet: the tab you are on. A tab's own panel, or floating: its tab.
export function useChatPage(conversationId: string, busy: boolean, onGone: () => void): PageTarget {
  const [binding, setBinding] = useState<{ conversationId: string; tabId: number }>();
  const bound = WINDOW_PANEL && binding?.conversationId === conversationId ? binding.tabId : undefined;
  const target = usePageTarget(bound, () => {
    setBinding(undefined);
    onGone();
  });
  useEffect(() => {
    if (WINDOW_PANEL && busy && bound === undefined && target.tabId !== undefined) setBinding({ conversationId, tabId: target.tabId });
  }, [busy, conversationId, bound, target.tabId]);
  return useMemo(() => (WINDOW_PANEL ? { ...target, bindTo: (tabId: number) => setBinding({ conversationId, tabId }) } : target), [target, conversationId]);
}
