// browser.unwatch cancels only a watch the agent started in this conversation: never the user's, nor
// another conversation's (a page could ask the model to).
import { describe, expect, it, vi } from 'vitest';
import type { Watch } from '../src/watches/store';
import { TOOL_SETTINGS } from './helpers';

const watches: Watch[] = [];
const endWatch = vi.fn(async () => undefined);
const addWatch = vi.fn();
vi.mock('wxt/browser', () => ({ browser: {} }));
vi.mock('../src/watches/run', () => ({ addWatch, endWatch }));
vi.mock('../src/watches/store', async (real) => ({ ...(await real<typeof import('../src/watches/store')>()), loadWatches: async () => watches }));
const { watchTools } = await import('../src/tools/browser/watch-tools');

const watch = (id: string, change: Partial<Watch>): Watch => ({ id, tabId: 1, spec: { gone: 'x' }, notify: true, continueChat: false, setBy: 'agent', origin: 'https://shop.example.com', title: 't', createdAt: 0, expiresAt: 1, ...change });
const unwatch = watchTools().find((t) => t.name === 'browser.unwatch')!;
const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal, conversationId: 'c1' };

describe('browser.unwatch', () => {
  it("cancels the agent's watch of this conversation only", async () => {
    watches.push(watch('mine', { conversationId: 'c1' }), watch('users', { setBy: 'user', conversationId: 'c1' }), watch('other', { conversationId: 'c2' }));
    expect(await unwatch.run({ id: 'users' }, ctx)).toMatchObject({ isError: true });
    expect(await unwatch.run({ id: 'other' }, ctx)).toMatchObject({ isError: true });
    expect(endWatch).not.toHaveBeenCalled();
    expect(await unwatch.run({ id: 'mine' }, ctx)).not.toHaveProperty('isError');
    expect(endWatch).toHaveBeenCalledWith('mine', { kind: 'cancelled' });
  });
});

describe('browser.watch', () => {
  it('takes its arguments with their types: a number that is not one is left out', async () => {
    const watchTool = watchTools().find((t) => t.name === 'browser.watch')!;
    await watchTool.run({ tabId: '3', gone: 'Stop', minutes: 'ten', stableMs: 'soon', notify: 'false' }, ctx).catch(() => undefined);
    expect(addWatch).toHaveBeenCalledWith(expect.objectContaining({ tabId: 3, spec: { gone: 'Stop' }, notify: false }));
    expect(addWatch).toHaveBeenCalledWith(expect.not.objectContaining({ minutes: expect.anything() }));
  });
});
