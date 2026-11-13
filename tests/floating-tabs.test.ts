import { describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

// Which tabs have the chat floating on the page they show now: known at once, for the capture's
// shortcut, which must open the side panel before awaiting anything.
const onUpdated = fakeEvent<(tabId: number, change: { status?: string; url?: string }) => void>();
const onRemoved = fakeEvent<(tabId: number) => void>();
const stored: Record<string, unknown> = { 'floating:5': {}, 'floating:6': {}, other: 1 };
vi.mock('wxt/browser', () => ({ browser: { tabs: { onUpdated, onRemoved }, storage: { session: { get: async () => stored } } } }));
// (storage keeps the keys of the last worker, as it would: they are not read)
const { floatingNow, listenFloatingTabs, markFloating } = await import('../src/background/floating-tabs');

describe('floating tabs', () => {
  it('none after the worker starts, though storage keeps the keys (they outlive the page): the side panel opens', async () => {
    listenFloatingTabs();
    await new Promise((r) => setTimeout(r, 10));
    expect(floatingNow(5)).toBe(false);
    expect(floatingNow(6)).toBe(false);
  });
  it('marked by the widget, forgotten when it closes', () => {
    markFloating(3, true);
    expect(floatingNow(3)).toBe(true);
    markFloating(3, false);
    expect(floatingNow(3)).toBe(false);
  });
  it('a page loading in the tab has no widget yet; a move inside the page (SPA) keeps it', () => {
    markFloating(3, true);
    onUpdated.emit(3, { url: 'https://shop.example.com/b' });
    expect(floatingNow(3)).toBe(true);
    onUpdated.emit(3, { status: 'loading' });
    expect(floatingNow(3)).toBe(false);
  });
  it('a closed tab is forgotten', () => {
    markFloating(4, true);
    onRemoved.emit(4);
    expect(floatingNow(4)).toBe(false);
  });
});
