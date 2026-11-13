import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));

const { deleteAllConversations, setPinned, applyRetention, retentionCount, deleteConversations, onConversationsDeleted, exportAll, importAll, listConversations, loadConversation, renameConversation, saveConversation } = await import('../src/history/store');
const { searchConversations } = await import('../src/history/search');
const { retentionLimit } = await import('../src/storage/retention');
const { heldName } = await import('../src/history/held');
const { conversationMarkdown } = await import('../src/history/markdown');
const { readBlock, searchResult, transcriptOf, findConversation } = await import('../src/history/read');
const { historyAutoOf, historyMentionOf, slugOf } = await import('../src/context/sources');
const { historyMentionItems } = await import('../src/history/mention');
const { stripMarks } = await import('../src/core/model-texts');
const { autoAttachItems } = await import('../src/history/auto');
const { docVersion } = await import('../src/history/search-doc');

const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }, { type: 'text', text: '<untrusted_page_content/>', context: 'page' }] });
const answer = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
const shot: Message = { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c', content: '[screenshot attached]', images: [{ mediaType: 'image/jpeg', data: 'AAAA' }] }] };
const save = (id: string, history: Message[], at = Date.now(), retention = {}) =>
  saveConversation({ id, history, createdAt: at, updatedAt: at, site: 'shop.test', model: 'm' }, retention);

beforeEach(() => storage.reset());

describe('conversation history', () => {
  it('keeps a pin made while a turn is being saved', async () => {
    await save('a', [user('one'), answer('1')]);
    await Promise.all([save('a', [user('one'), answer('1'), user('two'), answer('2')]), setPinned('a', true)]);
    expect((await listConversations())[0]).toMatchObject({ pinned: true, turns: 2 });
    expect(await loadConversation('a')).toMatchObject({ pinned: true, turns: 2 });
  });

  it('is saved after each turn, titled by your first message, without screenshots', async () => {
    await save('a', [user('Find the cheapest cable on this page, please'), shot, answer('Here.')]);
    const [meta] = await listConversations();
    expect(meta).toMatchObject({ id: 'a', title: 'Find the cheapest cable on this page, please', site: 'shop.test', turns: 1 });
    const kept = (await loadConversation('a'))!.history[1]!.parts[0]!;
    expect(kept.type === 'tool_result' && [kept.content, kept.images]).toEqual(['[screenshot not kept in the saved conversation]', undefined]);
  });

  it('keeps where and when it started, and a title you gave it', async () => {
    await save('a', [user('one')], 1000);
    await renameConversation('a', 'Cables');
    await saveConversation({ id: 'a', history: [user('one'), answer('x'), user('two')], createdAt: 5000, updatedAt: 5000, site: 'other.test' });
    expect(await listConversations()).toMatchObject([{ title: 'Cables', createdAt: 1000, updatedAt: 5000, site: 'shop.test', turns: 2 }]);
  });

  it('lists the latest first, finds them by their text, and forgets the old ones', async () => {
    const day = 86_400_000;
    await save('old', [user('about lamps')], Date.now() - 40 * day);
    await save('new', [user('about cables'), answer('USB-C cables')]);
    expect((await listConversations()).map((c) => c.id)).toEqual(['new', 'old']);
    expect((await searchConversations('usb-c')).map((c) => c.id)).toEqual(['new']);
    await applyRetention({ keepDays: 30 });
    expect((await listConversations()).map((c) => c.id)).toEqual(['new']);
    await save('newer', [user('x')]);
    expect(await retentionCount({ keepCount: 1 })).toBe(1); // asked first, nothing deleted
    expect(await listConversations()).toHaveLength(2);
    await applyRetention({ keepCount: 1 });
    expect((await listConversations()).map((c) => c.id)).toEqual(['newer']);
  });

  it('applies only whole numbers from 1 up as a retention, anything else keeps them all', async () => {
    const day = 86_400_000;
    await save('old', [user('a')], Date.now() - 2 * day);
    await save('mid', [user('b')], Date.now() - day);
    await save('new', [user('c')]);
    for (const bad of [0.5, -1, 0, Number.NaN, Infinity, '2' as unknown as number]) {
      expect(await retentionCount({ keepCount: bad, keepDays: bad })).toBe(0);
      await save('new', [user('c')], Date.now(), { keepCount: bad, keepDays: bad });
    }
    expect(await listConversations()).toHaveLength(3);
    expect(retentionLimit(2)).toBe(2);
    expect([0.5, -1, 0, Infinity, '2', undefined].map(retentionLimit)).toEqual([undefined, undefined, undefined, undefined, undefined, undefined]);
  });

  it('never deletes by retention a conversation another chat holds open, still counting it', async () => {
    const at = Date.now();
    for (const [i, id] of ['e', 'd', 'c', 'b', 'a'].entries()) await save(id, [user(id)], at - (5 - i) * 1000);
    vi.stubGlobal('navigator', { locks: { request: (_name: string, run: () => unknown) => run(), query: async () => ({ held: [{ name: heldName('manager', 'e') }, { name: heldName('chat', 'c') }] }) } });
    try {
      expect(await retentionCount({ keepCount: 2 })).toBe(1); // d: c and e are held
      await save('a', [user('a'), answer('done')], at, { keepCount: 2 });
      expect((await listConversations()).map((c) => c.id)).toEqual(['a', 'b', 'c', 'e']);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('exports and imports them all, and deletes them', async () => {
    await save('a', [user('one'), answer('two')]);
    const backup = await exportAll();
    await deleteConversations(['a']);
    expect(await listConversations()).toEqual([]);
    expect(await importAll(backup)).toBe(1);
    const withBroken = JSON.stringify({ conversations: [...JSON.parse(backup).conversations, { id: 'broken' }, null] });
    expect(await importAll(withBroken)).toBe(1); // those skipped are not counted
    expect((await loadConversation('a'))!.history).toHaveLength(2);
  });

  it('tells which conversations were deleted, and only those', async () => {
    await save('a', [user('one')]);
    await save('b', [user('two')]);
    const deleted = vi.fn();
    const off = onConversationsDeleted(deleted);
    await save('c', [user('three')]);
    await renameConversation('b', 'Two');
    expect(deleted).not.toHaveBeenCalled();
    await deleteConversations(['a', 'c']);
    expect(deleted).toHaveBeenCalledExactlyOnceWith(['c', 'a']) // in the index's order, latest first;
    off();
  });

  it('imports one exported alone, and one without its title or times, made whole', async () => {
    expect(await importAll(JSON.stringify({ id: 'alone', title: 'Alone', createdAt: 1, updatedAt: 2, turns: 1, history: [user('one')] }))).toBe(1);
    expect(await importAll(JSON.stringify({ conversations: [{ id: 'bare', history: [user('what is a platypus'), answer('a mammal')] }] }))).toBe(1);
    const listed = await listConversations();
    expect(listed.find((c) => c.id === 'alone')).toMatchObject({ title: 'Alone', updatedAt: 2 });
    expect(listed.find((c) => c.id === 'bare')).toMatchObject({ title: 'what is a platypus', turns: 1 });
    expect(Number.isFinite(listed.find((c) => c.id === 'bare')!.updatedAt)).toBe(true);
  });

  it('imports only the conversations a backup really has', async () => {
    const good = { id: 'g', title: 'Good', createdAt: 1, updatedAt: 1, turns: 1, history: [user('one')] };
    const backup = JSON.stringify({ conversations: [good, null, 'x', { id: 'h' }, { id: '', history: [] }, { id: 'm', history: [{ role: 'user' }] }] });
    expect(await importAll(backup)).toBe(1);
    expect((await listConversations()).map((c) => c.id)).toEqual(['g']);
    await expect(importAll('[]')).rejects.toThrow('No "conversations" list');
    await expect(importAll('null')).rejects.toThrow('No "conversations" list');
  });

  it('reads as Markdown: your messages and the answers, without the attached context', async () => {
    await save('a', [user('Hi'), answer('Hello!')]);
    const md = conversationMarkdown((await loadConversation('a'))!);
    expect(md).toContain('## You\n\nHi');
    expect(md).toContain('## Assistant\n\nHello!');
    expect(md).not.toContain('untrusted_page_content');
  });

  it('is titled and read as Markdown by how the chat shows a message; the model reads what it got', async () => {
    const wrapped = 'Explain <untrusted_page_content source="input">PLATYPUS</untrusted_page_content>';
    const fromAction: Message = { role: 'user', parts: [{ type: 'text', text: wrapped, shown: 'Explain PLATYPUS' }] };
    await save('a', [fromAction, answer('Sure.')]);
    expect((await listConversations())[0]!.title).toBe('Explain PLATYPUS');
    expect(conversationMarkdown((await loadConversation('a'))!)).toContain('## You\n\nExplain PLATYPUS');
    expect(stripMarks(transcriptOf((await loadConversation('a'))!))).toContain('PLATYPUS');
  });

  it('counts how much context it took at its last call', async () => {
    const answered: Message = { ...answer('Here.'), meta: { input: 3600, output: 40, reported: true, ms: 1, sinceStartMs: 1 } };
    await save('a', [user('Hi'), answered]);
    expect((await listConversations())[0]!.tokens).toBe(3640);
  });

  it('reads to the model as a transcript in an untrusted block; in full with the tool results', async () => {
    const calling: Message = { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: 'browser__find', args: {} }] };
    const found: Message = { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', content: 'button "USB-C cable"' }] };
    await save('a1b2c3d4-x', [user('Cheapest cable?'), calling, found, answer('The USB-C one, 9,99 €.')], Date.parse('2026-10-04'));
    const conv = (await findConversation('a1b2c3d4'))!;
    for (const tooShort of ['', '  ', 'a1b']) expect(await findConversation(tooShort)).toBeUndefined(); // not just the latest
    expect(transcriptOf(conv)).toBe('User: Cheapest cable?\nAssistant: (tools used: browser__find)\nAssistant: The USB-C one, 9,99 €.');
    expect(transcriptOf(conv, true)).toContain('Tool result (browser__find): button "USB-C cable"');
    expect(stripMarks(readBlock(conv))).toMatch(/^<untrusted_saved_conversation id="a1b2c3d4" title="Cheapest cable\?" date="2026-10-04" site="shop.test">\nUser:/);
  });

  it('is searched by the model with ids and snippets, leaving out the conversation it asks from', async () => {
    await save('aaaaaaaa-1', [user('Lamps'), answer('The brass lamp is 40 €.')]);
    await save('bbbbbbbb-2', [user('More about the brass lamp')]);
    const found = stripMarks(await searchResult('brass lamp', 5, 'bbbbbbbb-2'));
    expect(found).toContain('1 saved conversations match "brass lamp":\n- aaaaaaaa · "Lamps"');
    expect(found).toContain('The brass lamp is 40 €.');
    expect(stripMarks(await searchResult('zebra', 5))).toBe('No saved conversation matches "zebra".');
  });

  it('is attached with #title, the latest with that title; anything else stays plain text', async () => {
    await save('c1', [user('Cheapest cable on this page'), answer('USB-C')]);
    expect(slugOf('Cheapest cable on this page')).toBe('cheapest-cable-on-this-page');
    const [item] = await historyMentionItems('compare with #cheapest-cable-on-this-page and #1');
    expect(stripMarks(item!.text)).toMatch(/^The user attached the saved conversation "Cheapest cable on this page" \(\d{4}-\d{2}-\d{2}\):\n<untrusted_saved_conversation/);
    expect(historyMentionOf(item!.source)).toEqual({ slug: 'cheapest-cable-on-this-page', title: 'Cheapest cable on this page' });
    expect(await historyMentionItems('#cheapest-cable-on-this-page', 'c1')).toEqual([]); // not itself
  });

  it('keeps a pinned one through the retention and later saves, and searches it in full', async () => {
    const thinking: Message = { role: 'assistant', parts: [{ type: 'reasoning', text: 'the platypus lays eggs' }, { type: 'tool_call', id: 'c', name: 'browser__find', args: { query: 'echidna' } }] };
    await save('old', [user('Animals'), thinking], Date.now() - 40 * 86_400_000);
    expect(await searchConversations('echidna')).toEqual([]); // not pinned: only what was written
    await setPinned('old', true);
    await save('old', [user('Animals'), thinking, answer('Done.')], Date.now() - 40 * 86_400_000);
    await applyRetention({ keepDays: 30, keepCount: 1 });
    expect((await listConversations()).map((c) => [c.id, c.pinned])).toEqual([['old', true]]);
    expect((await searchConversations('echidna')).map((c) => c.id)).toEqual(['old']);
    expect((await searchConversations('platypus')).map((c) => c.id)).toEqual(['old']);
  });

  it('attaches a conversation on its own when the message matches it well enough (any, or only pinned ones), once per chat', async () => {
    await save('lamps', [user('Which lamp is cheapest?'), answer('The brass lamp is 40 €.')]);
    await save('cables', [user('Cheapest USB cable'), answer('The USB-C one.')]);
    // Among all of them by default; among the pinned ones only when asked.
    expect((await autoAttachItems('which brass lamp was cheapest', [], { enabled: true })).items).toHaveLength(1);
    const on = { enabled: true, scope: 'pinned' as const };
    expect((await autoAttachItems('which brass lamp was cheapest', [], on)).items).toEqual([]);
    await setPinned('lamps', true);
    const { items: [item], check } = await autoAttachItems('which brass lamp was cheapest', [], on);
    expect(check).toMatchObject({ threshold: 60, scope: 'pinned', best: { title: 'Which lamp is cheapest?' } });
    const auto = historyAutoOf(item!.source)!;
    expect([auto.id, auto.title, auto.match >= 60]).toEqual(['lamps', 'Which lamp is cheapest?', true]);
    expect(stripMarks(item!.text)).toMatch(/^A saved conversation that may be related to the user's message was attached automatically \(match \d+%\)/);
    // Not again in the same chat, nor when you mention it, nor below the threshold, nor when off.
    expect((await autoAttachItems('brass lamp cheapest', [{ role: 'user', parts: [{ type: 'text', text: 'x', context: 'page', source: item!.source }] }], on)).items).toEqual([]);
    expect((await autoAttachItems('brass lamp cheapest #which-lamp-is-cheapest', [], on)).items).toEqual([]);
    // Words no conversation has do not count against it; the others do.
    expect((await autoAttachItems('quiero probar: brass lamp', [], on)).items).toHaveLength(1);
    await save('weather', [user('Weather in Madrid tomorrow?'), answer('Sunny in Madrid.')]);
    const { items: none, check: below } = await autoAttachItems('brass lamp and the weather in Madrid tomorrow', [], on);
    expect([none, below!.best!.match < 60]).toEqual([[], true]);
    expect((await autoAttachItems('which brass lamp was cheapest', [], { enabled: false })).items).toEqual([]);
    // Among all, when asked: the cables one too.
    expect((await autoAttachItems('cheapest usb cable', [], { enabled: true, scope: 'all' })).items.map((i) => historyAutoOf(i.source)!.id)).toEqual(['cables']);
  });
});

describe('where a conversation started', () => {
  it('Agents Panel: said by its first save, kept by later ones', async () => {
    const at = Date.now();
    await saveConversation({ id: 'a', history: [user('one')], createdAt: at, updatedAt: at, origin: 'manager' });
    await saveConversation({ id: 'a', history: [user('one'), user('two')], createdAt: at, updatedAt: at });
    expect((await listConversations())[0]).toMatchObject({ origin: 'manager', turns: 2 });
    expect(await loadConversation('a')).toMatchObject({ origin: 'manager' });
  });
  it('one started elsewhere stays unmarked once it goes on in the Agents Panel', async () => {
    await save('b', [user('one')]);
    const at = Date.now();
    await saveConversation({ id: 'b', history: [user('one'), user('two')], createdAt: at, updatedAt: at, origin: 'manager' });
    expect((await listConversations())[0]!.origin).toBeUndefined();
  });
});

describe('the agents of a conversation', async () => {
  const { joinAgents, agentNames } = await import('../src/history/store');
  it('adds each agent once, in the order they took part', () => {
    const a = joinAgents(undefined, { id: 'builder', name: '🛠️ Builder' });
    const b = joinAgents({ agents: a }, { name: '🌐 Browser' });
    expect(joinAgents({ agents: b }, { id: 'builder', name: '🛠️ Builder' })).toEqual([{ id: 'builder', name: '🛠️ Builder' }, { name: '🌐 Browser' }]);
    expect(joinAgents({ agents: b }, { name: '🌐 Browser' })).toEqual(b);
  });
  it('one saved before (or by an older build) starts from the agent it names', () => {
    expect(joinAgents({ agentId: 'jira', agent: '🎫 jira' }, { name: '🌐 Browser' })).toEqual([{ id: 'jira', name: '🎫 jira' }, { name: '🌐 Browser' }]);
  });
  it('shows their names, or the one agent of one saved before', () => {
    expect(agentNames({ agents: [{ id: 'b', name: 'Builder' }, { name: 'Browser' }] })).toBe('Builder · Browser');
    expect(agentNames({ agent: 'jira' })).toBe('jira');
    expect(agentNames({})).toBeUndefined();
  });
  it('saving keeps the last agent as before, and the list', async () => {
    const at = Date.now();
    await saveConversation({ id: 'a', history: [user('one')], createdAt: at, updatedAt: at, agentId: 'builder', agent: '🛠️ Builder', talkedTo: { id: 'builder', name: '🛠️ Builder' } });
    await saveConversation({ id: 'a', history: [user('one'), user('two')], createdAt: at, updatedAt: at, talkedTo: { name: '🌐 Browser' } });
    const [meta] = await listConversations();
    expect(meta).toMatchObject({ agents: [{ id: 'builder', name: '🛠️ Builder' }, { name: '🌐 Browser' }] });
    expect(meta!.agentId).toBeUndefined();
    expect(meta).not.toHaveProperty('talkedTo');
  });
});

describe('history stored or imported malformed', () => {
  it('reads an index or a conversation of another shape as none, instead of throwing', async () => {
    storage.local.data.convIndex = { not: 'a list' };
    expect(await listConversations()).toEqual([]);
    storage.local.data.convIndex = [null, 'x', { id: 'c1', title: 'One', updatedAt: 1, createdAt: 1, turns: 1 }];
    expect((await listConversations()).map((c) => c.id)).toEqual(['c1']);
    storage.local.data['conv:c1'] = 'garbage';
    expect(await loadConversation('c1')).toBeUndefined();
    expect(await searchConversations('one')).toEqual([]);
  });

  it('drops malformed parts on import, so a search still finds every conversation', async () => {
    const backup = {
      conversations: [
        { id: 'bad', title: 'Broken', history: [{ role: 'user', parts: [{ type: 'text' }, 5, { type: 'text', text: 'invoice address' }] }] },
        { id: 'good', title: 'Fine', history: [user('invoice address')] },
      ],
    };
    expect(await importAll(JSON.stringify(backup))).toBe(2);
    expect((await loadConversation('bad'))!.history[0]!.parts).toEqual([{ type: 'text', text: 'invoice address' }]);
    expect((await searchConversations('invoice')).map((c) => c.id).sort()).toEqual(['bad', 'good']);
  });

  it('leaves out of a search a stored conversation it cannot index, not every one', async () => {
    await save('good', [user('invoice address')]);
    storage.local.data['conv:bad'] = { id: 'bad', title: 'Broken', updatedAt: 1, createdAt: 1, turns: 1, history: [{ role: 'user', parts: [{ type: 'text' }] }] };
    storage.local.data.convIndex = [...(storage.local.data.convIndex as object[]), { id: 'bad', title: 'Broken', updatedAt: 1, createdAt: 1, turns: 1 }];
    expect((await searchConversations('invoice')).map((c) => c.id)).toEqual(['good']);
  });
});

describe('history search documents stored', () => {
  const docOf = (id: string) => storage.local.data[`convSearch:${id}`] as { version: string; terms: string } | undefined;
  const termsOf = (id: string) => docOf(id)?.terms.split(' ') ?? [];
  const versionOf = async (id: string) => docVersion((await listConversations()).find((c) => c.id === id)!);

  it('are written with each save, rename and pin, as of the index entry', async () => {
    await save('a', [user('brass lamp')]);
    expect(termsOf('a')).toContain('bras');
    expect(docOf('a')!.version).toBe(await versionOf('a'));
    await save('a', [user('brass lamp'), answer('walnut desk')]);
    expect(termsOf('a')).toContain('walnut');
    await renameConversation('a', 'Ornaments');
    expect(termsOf('a')).toContain('ornament');
    await setPinned('a', true);
    expect(docOf('a')!.version).toBe(await versionOf('a'));
  });

  it('go with their conversations: deleted, kept by the retention, never exported nor imported', async () => {
    const day = 86_400_000;
    await save('old', [user('lamp')], Date.now() - 40 * day);
    await save('a', [user('lamp')]);
    await save('b', [user('lamp')]);
    await applyRetention({ keepDays: 30 });
    expect(docOf('old')).toBeUndefined();
    await deleteConversations(['a']);
    expect([docOf('a'), docOf('b')].map(Boolean)).toEqual([false, true]);
    const backup = await exportAll();
    expect(backup).not.toContain('terms');
    await deleteAllConversations();
    expect(Object.keys(storage.local.data).filter((k) => k.startsWith('convSearch:'))).toEqual([]);
    await importAll(backup);
    expect(await loadConversation('b')).toBeDefined();
    expect(docOf('b')).toBeUndefined(); // left to the searches to build
  });

  it('replaced by an import are dropped, not left to answer for another conversation', async () => {
    await save('a', [user('brass lamp')]);
    await importAll(JSON.stringify({ conversations: [{ id: 'a', title: 'Other', history: [user('walnut desk')] }] }));
    expect(docOf('a')).toBeUndefined();
  });
});
