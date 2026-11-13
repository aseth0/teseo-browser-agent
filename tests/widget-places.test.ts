// The widget's place per site (widget/places): one record written by the widgets of several tabs and by
// Settings → Bubble, each change made inside one lock, in the background for a widget.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

// Slow reads, so two read-modify-writes overlap unless they take turns.
const storage = fakeStorage({ delayMs: 5 });
const runtime = vi.hoisted(() => ({ origin: 'chrome-extension://ext', sent: [] as unknown[] }));
vi.mock('wxt/browser', () => ({
  browser: fakeBrowser(storage, {
    runtime: {
      getURL: (path: string) => `${runtime.origin}${path}`,
      sendMessage: async (msg: unknown) => {
        runtime.sent.push(msg);
        const { changePlace } = await import('../src/widget/places');
        const { site, patch } = msg as { site: string; patch: object };
        return changePlace(site, patch); // as the background does
      },
    },
  }),
}));
const { forgetChatPlaces, loadPlaces, updatePlace } = await import('../src/widget/places');
const { WIDGET_PLACE } = await import('../src/widget/protocol');

beforeEach(() => {
  storage.reset();
  runtime.sent = [];
});
afterEach(() => vi.unstubAllGlobals());

describe('widget places', () => {
  it('in an extension page, kept together with the others made at once', async () => {
    vi.stubGlobal('location', { origin: 'chrome-extension://ext' });
    await Promise.all([updatePlace('a.example.com', { x: 1 }), updatePlace('b.example.com', { hidden: true }), forgetChatPlaces(), updatePlace('a.example.com', { y: 2 })]);
    expect(await loadPlaces()).toEqual({ 'a.example.com': { x: 1, y: 2 }, 'b.example.com': { hidden: true } });
    expect(runtime.sent).toEqual([]);
  });

  it('from a page (a content script), asked of the background, and kept together too', async () => {
    vi.stubGlobal('location', { origin: 'https://a.example.com' });
    const [place] = await Promise.all([updatePlace('a.example.com', { x: 1 }), updatePlace('b.example.com', { x: 2 }), updatePlace('a.example.com', { y: 3 })]);
    expect(place).toEqual({ x: 1 });
    expect(runtime.sent[0]).toEqual({ type: WIDGET_PLACE, site: 'a.example.com', patch: { x: 1 } });
    expect(await loadPlaces()).toEqual({ 'a.example.com': { x: 1, y: 3 }, 'b.example.com': { x: 2 } });
  });
});

describe('widgetSite', () => {
  it("is the page's host, with its port, as the widget keys its place and the background checks it", async () => {
    const { widgetSite } = await import('../src/widget/places');
    expect(widgetSite('https://shop.example.com/cart?x=1')).toBe('shop.example.com');
    expect(widgetSite('http://localhost:8080/')).toBe('localhost:8080');
    expect(widgetSite(undefined)).toBe('');
    expect(widgetSite('not a url')).toBe('');
  });
});
