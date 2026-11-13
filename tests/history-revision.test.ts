// A conversation several chats show (the pinned one, floating on several tabs): a chat saves it only
// over the revision it last loaded or saved, never over what another chat saved since.
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { Message } from '../src/core/types';

vi.mock('wxt/browser', () => ({ browser: fakeBrowser(fakeStorage()) }));
const { browser } = await import('wxt/browser');
const { forgetRevision, loadConversation, noteRevision, knownRevision, saveConversation, savedSince } = await import('../src/history/store');

const say = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });
const save = (id: string, history: Message[], checked = false) => saveConversation({ id, history, createdAt: 1, updatedAt: 1 }, {}, { checked });

describe('a checked save', () => {
  it('counts a revision on every save, and notes its own', async () => {
    expect(await save('a', [say('one')])).toBe(true);
    expect((await loadConversation('a'))?.revision).toBe(1);
    expect(await save('a', [say('one'), say('two')], true)).toBe(true);
    expect((await loadConversation('a'))?.revision).toBe(2);
    expect(knownRevision('a')).toBe(2);
  });
  it('is refused once another chat saved since, and the saved one stays', async () => {
    noteRevision((await loadConversation('a'))!);
    await save('a', [say('one'), say('two'), say('elsewhere')]); // another chat's turn
    expect(savedSince('a', await loadConversation('a'))).toBe(true);
    expect(await save('a', [say('one'), say('two'), say('stale')], true)).toBe(false);
    const kept = await loadConversation('a');
    expect(kept?.history.at(-1)).toEqual(say('elsewhere'));
    noteRevision(kept!); // shown as saved: its next save goes
    expect(await save('a', [...kept!.history, say('on')], true)).toBe(true);
  });
  it('is refused once it was deleted', async () => {
    noteRevision({ id: 'gone', revision: 3 });
    expect(await save('gone', [say('back')], true)).toBe(false);
    expect(await loadConversation('gone')).toBeUndefined();
  });
  it('one this page knows nothing of goes (a conversation started here, or handed to it)', async () => {
    expect(await save('new', [say('hi')], true)).toBe(true);
    expect(savedSince('unknown', undefined)).toBe(false);
  });

  it('a write that fails leaves the revision known as it was: the next save goes', async () => {
    await save('w', [say('one')], true);
    expect(knownRevision('w')).toBe(1);
    const set = vi.spyOn(browser.storage.local, 'set').mockRejectedValueOnce(new Error('quota'));
    await expect(save('w', [say('one'), say('two')], true)).rejects.toThrow('quota');
    set.mockRestore();
    expect(knownRevision('w')).toBe(1);
    expect(await save('w', [say('one'), say('two')], true)).toBe(true);
    expect(knownRevision('w')).toBe(2);
  });
  it('opened from a handoff (its revision unknown): nothing checked against it', async () => {
    noteRevision({ id: 'h', revision: 9 });
    forgetRevision('h');
    expect(await save('h', [say('handed')], true)).toBe(true);
  });

  it('the record written and its index not (a partial write): checked against the record, the next revision after both', async () => {
    await save('r', [say('one')], true); // revision 1
    // Done by hand: the record at revision 2, the index still at 1.
    const record = (await loadConversation('r'))!;
    await browser.storage.local.set({ 'conv:r': { ...record, history: [say('one'), say('two')], revision: 2 } });
    noteRevision((await loadConversation('r'))!); // a chat loads it: 2
    expect(await save('r', [say('one'), say('two'), say('three')], true)).toBe(true);
    expect((await loadConversation('r'))?.revision).toBe(3);
  });
});
