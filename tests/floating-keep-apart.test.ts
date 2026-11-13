// A turn of the pinned conversation whose save was refused (another chat saved it since) is never
// dropped: it is kept as a conversation of its own, the one saved elsewhere left as it is.
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { Message } from '../src/core/types';

vi.mock('wxt/browser', () => ({ browser: fakeBrowser(fakeStorage()) }));
const { keepApart, listConversations, loadConversation, noteRevision, saveConversation } = await import('../src/history/store');

const say = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });

describe('a turn whose save was refused', () => {
  it('is kept apart, under a new id, and the saved one stays', async () => {
    await saveConversation({ id: 'p', history: [say('one')], createdAt: 1, updatedAt: 1 }, {}, { checked: true });
    noteRevision({ id: 'p', revision: 1 });
    await saveConversation({ id: 'p', history: [say('one'), say('elsewhere')], createdAt: 1, updatedAt: 2 }); // another tab
    const mine = { id: 'p', history: [say('one'), say('mine')], createdAt: 1, updatedAt: 3 };
    expect(await saveConversation(mine, {}, { checked: true })).toBe(false);
    expect(await keepApart(mine)).toBe(true);
    const all = await listConversations();
    expect(all).toHaveLength(2);
    const apart = all.find((c) => c.id !== 'p')!;
    expect((await loadConversation(apart.id))?.history.at(-1)).toEqual(say('mine'));
    expect((await loadConversation('p'))?.history.at(-1)).toEqual(say('elsewhere'));
  });

  it('one copy per turn: a refusal mid-turn, then at its end, under the same id', async () => {
    const before = (await listConversations()).length;
    const partial = { id: 'p', history: [say('one'), say('half')], createdAt: 1, updatedAt: 4 };
    const whole = { id: 'p', history: [say('one'), say('half'), say('whole')], createdAt: 1, updatedAt: 5 };
    await keepApart(partial, 'apart-1');
    await keepApart(whole, 'apart-1');
    expect((await listConversations()).length).toBe(before + 1);
    expect((await loadConversation('apart-1'))?.history.at(-1)).toEqual(say('whole'));
  });
});
