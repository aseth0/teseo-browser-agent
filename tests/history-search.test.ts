import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));

const { listConversations, loadConversations, saveConversation, setPinned, writeSearchDocs } = await import('../src/history/store');
const { rankSaved, searchConversations, searchList } = await import('../src/history/search');
const { rank, searchDocFor } = await import('../src/history/rank');
const { autoAttachItems } = await import('../src/history/auto');
const { docVersion } = await import('../src/history/search-doc');

const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });
const answer = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
const save = (id: string, history: Message[], at = Date.now()) => saveConversation({ id, history, createdAt: at, updatedAt: at, model: 'm' });

// A save by a build without search documents: the conversation and its index entry, its document left as it was.
const olderSave = (id: string, title: string, history: Message[], at: number) => {
  const meta = { id, title, createdAt: at, updatedAt: at, turns: history.filter((m) => m.role === 'user').length };
  storage.local.data[`conv:${id}`] = { ...meta, history };
  const index = ((storage.local.data.convIndex as { id: string }[] | undefined) ?? []).filter((c) => c.id !== id);
  storage.local.data.convIndex = [meta, ...index];
};

// The conversations read whole while `run` runs.
async function wholeReads(run: () => Promise<unknown>): Promise<string[]> {
  const read: string[] = [];
  const get = storage.local.get;
  storage.local.get = (keys) => {
    for (const k of [keys ?? []].flat() as string[]) if (k.startsWith('conv:')) read.push(k.slice(5));
    return get.call(storage.local, keys);
  };
  try {
    await run();
  } finally {
    storage.local.get = get;
  }
  return read.sort();
}

beforeEach(() => storage.reset());

describe('history search from the search documents', () => {
  it('reads whole only the results it returns', async () => {
    for (let i = 0; i < 6; i++) await save(`c${i}`, [user(`brass lamp number ${i}`), answer(i % 2 ? 'walnut desk' : 'oak shelf')], 1000 + i);
    const read = await wholeReads(async () => expect((await searchConversations('walnut', { limit: 2 })).map((c) => c.id)).toEqual(['c5', 'c3']));
    expect(read).toEqual(['c3', 'c5']);
    expect(await wholeReads(() => searchConversations('platypus'))).toEqual([]);
  });

  it('ranks as the conversations themselves, prefixes and quoted phrases too', async () => {
    await save('a', [user('a brass lamp for the desk'), answer('Three brass lamps under 40 €')], 1);
    await save('b', [user('the cheapest usb-c cable'), answer('The 2 m cable, precio del cable 9 €')], 2);
    await save('c', [user('a walnut desk and a lamp'), answer('This desk, ornithorhynchus brand')], 3);
    await setPinned('c', true);
    const all = await loadConversations((await listConversations()).map((c) => c.id));
    for (const [q, prefix] of [['lamp desk', false], ['orn', true], ['"precio del cable"', false], ['cable', true]] as const) {
      const expected = rank(q, all, { prefix }).map((r) => ({ id: r.conv.id, score: r.score, match: r.match }));
      expect(expected.length, q).toBeGreaterThan(0);
      expect((await rankSaved(q, { prefix })).ranked.map((r) => ({ id: r.meta.id, score: r.score, match: r.match })), q).toEqual(expected);
    }
    expect((await searchConversations('"precio del cable"')).map((c) => c.id)).toEqual(['b']);
  });

  it('lists every match, the best ones whole for their snippets', async () => {
    for (let i = 0; i < 4; i++) await save(`c${i}`, [user(`ornament ${i}`)], 1000 + i);
    const list = await searchList('orn', { prefix: true, whole: 2 });
    expect(list.map((c) => [c.id, 'history' in c])).toEqual([['c3', true], ['c2', true], ['c1', false], ['c0', false]]);
  });

  it('indexes a conversation an older build saved, stale or new, and stores its document after', async () => {
    await save('a', [user('brass lamp')], 1000);
    olderSave('a', 'brass lamp', [user('brass lamp'), answer('the walnut desk')], 2000); // its document is stale
    olderSave('b', 'walnut', [user('walnut chair')], 3000); // none
    const { ranked, rebuilt } = await rankSaved('walnut');
    expect(ranked.map((r) => r.meta.id).sort()).toEqual(['a', 'b']);
    await rebuilt;
    for (const id of ['a', 'b']) expect((storage.local.data[`convSearch:${id}`] as { version: string }).version).toBe(docVersion((await listConversations()).find((c) => c.id === id)!));
    expect(await wholeReads(() => rankSaved('walnut'))).toEqual([]);
  });

  it('reads a malformed document as none, and builds it again', async () => {
    await save('a', [user('brass lamp')]);
    storage.local.data['convSearch:a'] = { ...(storage.local.data['convSearch:a'] as object), tenths: 'broken' }; // its version still right
    expect(await wholeReads(async () => expect((await searchConversations('lamp')).map((c) => c.id)).toEqual(['a']))).toEqual(['a']);
    await (await rankSaved('lamp')).rebuilt;
    expect(await wholeReads(() => rankSaved('lamp'))).toEqual([]);
  });

  it('stores a bounded number of the documents it built, a batch at a time', async () => {
    for (let i = 0; i < 130; i++) olderSave(`c${i}`, `lamp ${i}`, [user(`lamp ${i}`)], i);
    const set = vi.spyOn(storage.local, 'set');
    const first = await rankSaved('lamp');
    expect(first.ranked).toHaveLength(130);
    await first.rebuilt;
    expect(set.mock.calls.map(([items]) => Object.keys(items).length)).toEqual([25, 25, 25, 25]);
    set.mockRestore();
    expect(await wholeReads(async () => (await rankSaved('lamp')).rebuilt)).toHaveLength(30);
    expect(await wholeReads(() => rankSaved('lamp'))).toEqual([]);
  });

  it('does not store a document of a conversation changed since it was built', async () => {
    olderSave('a', 'lamp', [user('lamp')], 1);
    const [conv] = await loadConversations(['a']);
    const doc = searchDocFor(conv!);
    olderSave('a', 'lamp', [user('lamp'), user('walnut')], 2);
    await writeSearchDocs([['a', doc]], 25);
    expect(storage.local.data['convSearch:a']).toBeUndefined();
  });

  it('auto-attach reads whole only the conversations it attaches', async () => {
    await save('lamp', [user('which brass lamp is the cheapest'), answer('the brass lamp at 30 €')], 2);
    await save('other', [user('a walnut desk'), answer('brass handles')], 1);
    const read = await wholeReads(async () => expect((await autoAttachItems('which brass lamp was cheapest', [], { enabled: true })).items).toHaveLength(1));
    expect(read).toEqual(['lamp']);
  });
});
