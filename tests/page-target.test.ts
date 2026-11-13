// @vitest-environment jsdom
// The page the chat works on (usePageTarget): in the window's side panel, the tab its conversation is
// bound to stays its page while you go to other tabs, until it is closed.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { PageTarget } from '../src/entrypoints/sidepanel/usePageTarget';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { fakeEvent } = await import('./fakes/browser');
type Tab = { id: number; windowId: number; url: string; title: string; active: boolean };
const tabs: Tab[] = [
  { id: 1, windowId: 9, url: 'https://a.example.com/', title: 'A', active: true },
  { id: 2, windowId: 9, url: 'https://b.example.com/', title: 'B', active: false },
];
const onActivated = fakeEvent<() => void>();
const onRemoved = fakeEvent<() => void>();
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { getURL: (p: string) => `chrome-extension://id${p}` },
    windows: { getLastFocused: async () => ({ tabs: tabs.map((t) => ({ ...t })) }), onFocusChanged: fakeEvent() },
    tabs: {
      get: async (id: number) => {
        const tab = tabs.find((t) => t.id === id);
        if (!tab) throw new Error(`No tab with id: ${id}`);
        return { ...tab };
      },
      onActivated, onRemoved, onUpdated: fakeEvent(),
    },
    permissions: { contains: async () => true, onAdded: fakeEvent(), onRemoved: fakeEvent() },
  },
}));
const { useChatPage, usePageTarget } = await import('../src/entrypoints/sidepanel/usePageTarget');

const switchTo = (id: number) => {
  for (const t of tabs) t.active = t.id === id;
  onActivated.emit();
};

async function render(bound: number | undefined, onGone = vi.fn()) {
  let page!: PageTarget;
  function Probe(props: { bound?: number }) {
    page = usePageTarget(props.bound, onGone);
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe, { bound })));
  return { page: () => page, rerender: (b?: number) => act(async () => root.render(createElement(Probe, { bound: b }))), onGone };
}

describe('usePageTarget', () => {
  it('follows the tab you are on while the conversation is bound to none', async () => {
    const at = await render(undefined);
    expect(at.page()).toMatchObject({ tabId: 1, windowId: 9, access: 'ok' });
    await act(async () => switchTo(2));
    expect(at.page().tabId).toBe(2);
    expect(at.page().elsewhere).toBeUndefined();
    await act(async () => switchTo(1));
  });

  it('stays on the bound tab when you go to another, saying which one you are on', async () => {
    const at = await render(1);
    await act(async () => switchTo(2));
    expect(at.page()).toMatchObject({ tabId: 1, url: 'https://a.example.com/', title: 'A' });
    expect(at.page().elsewhere).toEqual({ tabId: 2, title: 'B', url: 'https://b.example.com/' });
    // "Use this tab": bound to the one you are on.
    await at.rerender(2);
    expect(at.page().tabId).toBe(2);
    expect(at.page().elsewhere).toBeUndefined();
  });

  it('goes to the tab you are on once the bound one is closed, and says so', async () => {
    const at = await render(1);
    await act(async () => switchTo(2));
    tabs.splice(0, 1);
    await act(async () => onRemoved.emit());
    expect(at.onGone).toHaveBeenCalled();
    expect(at.page().tabId).toBe(2);
  });
});

describe('useChatPage', () => {
  type Props = { conversationId: string; busy: boolean };
  async function chat(props: Props) {
    let page!: PageTarget;
    function Probe(p: Props) {
      page = useChatPage(p.conversationId, p.busy, () => undefined);
      return null;
    }
    const root = createRoot(document.createElement('div'));
    const show = (p: Props) => act(async () => root.render(createElement(Probe, p)));
    await show(props);
    return { page: () => page, show };
  }

  it('binds the conversation to the tab its first turn runs on, until "Use this tab" or another conversation', async () => {
    tabs.splice(0, tabs.length, { id: 1, windowId: 9, url: 'https://a.example.com/', title: 'A', active: true }, { id: 2, windowId: 9, url: 'https://b.example.com/', title: 'B', active: false });
    const at = await chat({ conversationId: 'c1', busy: false });
    await at.show({ conversationId: 'c1', busy: true }); // a turn runs on A
    await at.show({ conversationId: 'c1', busy: false });
    await act(async () => switchTo(2));
    expect(at.page()).toMatchObject({ tabId: 1, elsewhere: { tabId: 2 } });
    await act(async () => at.page().bindTo!(at.page().elsewhere!.tabId)); // "Use this tab"
    expect(at.page().tabId).toBe(2);
    expect(at.page().elsewhere).toBeUndefined();
    await act(async () => switchTo(1));
    expect(at.page().tabId).toBe(2); // bound to B now
    await at.show({ conversationId: 'c2', busy: false }); // a new one: the tab you are on
    expect(at.page().tabId).toBe(1);
  });

  it('binds the conversation to a tab chosen in the picker, before any turn and in another window', async () => {
    tabs.splice(0, tabs.length,
      { id: 1, windowId: 9, url: 'https://a.example.com/', title: 'A', active: true },
      { id: 3, windowId: 4, url: 'https://app.example.test/', title: 'App', active: true });
    const at = await chat({ conversationId: 'c1', busy: false });
    expect(at.page().tabId).toBe(1);
    await act(async () => at.page().bindTo!(3));
    expect(at.page()).toMatchObject({ tabId: 3, windowId: 4, title: 'App', elsewhere: { tabId: 1 } });
    await act(async () => switchTo(1));
    expect(at.page().tabId).toBe(3); // kept as you move on
    await act(async () => at.page().bindTo!(1)); // back to the tab you are on
    expect(at.page().tabId).toBe(1);
    expect(at.page().elsewhere).toBeUndefined();
  });

  it('binds to a restricted tab with the restricted state', async () => {
    tabs.splice(0, tabs.length,
      { id: 1, windowId: 9, url: 'https://a.example.com/', title: 'A', active: true },
      { id: 5, windowId: 9, url: 'chrome://settings/', title: 'Settings', active: false });
    const at = await chat({ conversationId: 'c1', busy: false });
    await act(async () => at.page().bindTo!(5));
    expect(at.page()).toMatchObject({ tabId: 5, access: 'restricted' });
  });
});
