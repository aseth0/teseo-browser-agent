import { describe, expect, it, vi } from 'vitest';

// The background opens the offscreen document for the floating chat's dictation: for the extension's
// pages only, with why not when it cannot.
const listeners: ((m: unknown, s: unknown, r: (x: unknown) => void) => boolean | void)[] = [];
vi.mock('wxt/browser', () => ({
  browser: { offscreen: {}, runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext${p}`, onMessage: { addListener: (l: never) => listeners.push(l) } } },
}));
let opening: () => Promise<void> = async () => undefined;
vi.mock('../src/audio/offscreen-document', () => ({ offscreenReady: () => opening() }));
const { DICTATION_OFFSCREEN } = await import('../src/voice/protocol');
const { hostDictation } = await import('../src/background/dictation-host');
hostDictation();

const ask = (sender: unknown) => new Promise((r) => {
  if (listeners[0]!({ type: DICTATION_OFFSCREEN }, sender, r) !== true) r(undefined);
});

describe('the offscreen document for dictation', () => {
  it('opened for the floating chat, or why not', async () => {
    expect(await ask({ url: 'chrome-extension://ext/floating.html' })).toEqual({});
    opening = async () => {
      throw new Error('Only a single offscreen document may be created.');
    };
    expect(await ask({ url: 'chrome-extension://ext/floating.html' })).toEqual({ error: 'Only a single offscreen document may be created.' });
  });
  it("never for a page's content script", async () => {
    expect(await ask({ url: 'https://example.com/', tab: { id: 1 } })).toBeUndefined();
  });
});
