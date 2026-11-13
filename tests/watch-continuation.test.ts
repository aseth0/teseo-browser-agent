// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { EndedWatch } from '../src/watches/store';

// A met watch set from the open conversation goes on with it: it leaves the ended ones only once the
// chat took its message; refused (a turn started meanwhile), it stays, to go once the chat is idle.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage, { tabs: { get: async () => ({ url: 'https://shop.example.com/cart' }) } }) }));
const { loadEndedWatches, WATCHES_ENDED_KEY } = await import('../src/watches/store');
const { useWatchContinuation } = await import('../src/entrypoints/sidepanel/WatchesMenu');

const met: EndedWatch = {
  watch: { id: 'w1', tabId: 1, spec: { gone: 'x' }, notify: false, continueChat: true, conversationId: 'c1', setBy: 'agent', origin: 'https://shop.example.com', title: 't', createdAt: 0, expiresAt: 1 },
  end: { kind: 'met', fired: { ms: 5, met: [] } },
  at: 2,
};

function Chat({ ready, send }: { ready: boolean; send: (message: string) => boolean }) {
  useWatchContinuation('c1', ready, send);
  return null;
}
const settle = () => act(async () => { for (let i = 0; i < 10; i++) await new Promise((r) => setTimeout(r)); });

describe('useWatchContinuation', () => {
  it('a refused send leaves the met watch to go later; an accepted one takes it', async () => {
    await storage.session.set({ [WATCHES_ENDED_KEY]: [met] });
    const root = createRoot(document.createElement('div'));
    const refused = vi.fn(() => false);
    await act(async () => root.render(createElement(Chat, { ready: true, send: refused })));
    await settle();
    expect(refused).toHaveBeenCalled();
    expect((await loadEndedWatches()).map((e) => e.watch.id)).toEqual(['w1']);

    const accepted = vi.fn(() => true);
    await act(async () => root.render(createElement(Chat, { ready: false, send: accepted })));
    await act(async () => root.render(createElement(Chat, { ready: true, send: accepted })));
    await settle();
    expect(accepted).toHaveBeenCalledOnce();
    expect(await loadEndedWatches()).toEqual([]);
    act(() => root.unmount());
  });
});
