// The pin on the floating chat's bar: the conversation of that tab's floating chat, once saved, becomes
// the pinned one; unpinned by the pin, or once deleted.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

vi.mock('wxt/browser', () => ({ browser: fakeBrowser(fakeStorage()) }));
const { browser } = await import('wxt/browser');
const { pinFloating: pinOn, unpinIf } = await import('../src/background/sticky-chat');
const pinFloating = (id: number, on: boolean) => pinOn({ id }, on);
const { STICKY_CHAT } = await import('../src/widget/protocol');
const { conversationKey } = await import('../src/history/store');

const pinned = async () => (await browser.storage.session.get(STICKY_CHAT))[STICKY_CHAT];

beforeEach(async () => {
  await browser.storage.session.clear();
  await browser.storage.local.clear();
  await browser.storage.local.set({ [conversationKey('saved')]: { id: 'saved', history: [] } });
  await browser.storage.session.set({ 'floating:4': { conversationId: 'saved' }, 'floating:7': { conversationId: 'unsaved' }, 'floating:9': {} });
});

describe('the pin', () => {
  it("pins the conversation of that tab's floating chat, once saved", async () => {
    expect(await pinFloating(4, true)).toBe(true);
    expect(await pinned()).toEqual({ conversationId: 'saved' });
  });
  it('pins none not saved (temporary, its first turn not saved yet) nor a chat without one', async () => {
    expect(await pinFloating(7, true)).toBe(false);
    expect(await pinFloating(9, true)).toBe(false);
    expect(await pinFloating(12, true)).toBe(false);
    expect(await pinned()).toBeUndefined();
  });
  it('one not saved leaves the one pinned as it was', async () => {
    await pinFloating(4, true);
    expect(await pinFloating(7, true)).toBe(true);
    expect(await pinned()).toEqual({ conversationId: 'saved' });
  });
  it('unpins from any tab', async () => {
    await pinFloating(4, true);
    expect(await pinFloating(7, false)).toBe(false);
    expect(await pinned()).toBeUndefined();
  });
});

describe('the pinned conversation deleted, or moved to the side panel', () => {
  it('is unpinned; another one leaves it pinned (a newer pin stays)', async () => {
    await pinFloating(4, true);
    await unpinIf(['other']);
    expect(await pinned()).toEqual({ conversationId: 'saved' });
    await unpinIf(['other', 'saved']);
    expect(await pinned()).toBeUndefined();
  });
});

describe('an incognito tab', () => {
  it('pins nothing: its floating chat does not follow the pin', async () => {
    expect(await pinOn({ id: 4, incognito: true }, true)).toBe(false);
    expect(await pinned()).toBeUndefined();
  });
});
