import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import { TOOL_SETTINGS } from './helpers';

const storage = fakeStorage();
const secrets = fakeSecretDb(); // agents' sites (agents/profiles)
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { stripMarks, text } = await import('../src/core/model-texts');
const { setLimitOverrides } = await import('../src/core/limits');
const { buildSystemPrompt, excludedTools } = await import('../src/context/request');
const { memoryInstructions, memorySiteItems } = await import('../src/memory/prompt');
const { appendContext } = await import('../src/core/messages');
const { memoryIndexSource } = await import('../src/context/sources');
const { MEMORY_TOOLS } = await import('../src/core/memory-names');
const { memoryFor, memoryStore, newMemoryItem, onDomain, domainOf } = await import('../src/memory/store');
const { memoryTools } = await import('../src/memory/tools');
const { searchMemory, siteMemoryMatches } = await import('../src/memory/items');
const { exportMemory, importMemory } = await import('../src/memory/io');
const { seenBy, newAgentProfile } = await import('../src/agents/profiles');
type MemoryItem = import('../src/memory/store').MemoryItem;
type SiteMatch = import('../src/memory/prompt').SiteMatch;
type ContextItem = import('../src/core/messages').ContextItem;
type Message = import('../src/core/types').Message;

const item = (id: string, change: Partial<MemoryItem> = {}): MemoryItem => ({ ...newMemoryItem([], { text: `Rule ${id}`, ...change }), id, updatedAt: change.updatedAt ?? 1 });
const settings = { providers: [], systemPrompt: 'Be brief.' };
const tool = (name: string) => memoryTools().find((t) => t.name === name)!;
const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal };

beforeEach(() => {
  storage.reset();
  setLimitOverrides(undefined);
});

describe('the items of the open site, by what you wrote', () => {
  const HOST = 'shop.example.com';
  const site = (id: string, title: string, body: string, change: Partial<MemoryItem> = {}) => item(id, { domains: ['example.com'], title, text: body, ...change });
  const match = (typed: string, change: Partial<SiteMatch> = {}): SiteMatch => ({ typed, threshold: 60, searches: true, ...change });
  const said = (items: { text: string }[]) => items.map((i) => stripMarks(i.text)).join('\n');
  const asHistory = (items: ContextItem[]): Message[] => appendContext([{ role: 'user', parts: [{ type: 'text', text: 'x' }] }], items);
  const pinned = site('m-pin', 'Account', 'Use the staging account.', { pinned: true, updatedAt: 2 });
  const filters = site('m-fil', 'Filters', 'The filters are in the side menu.', { updatedAt: 3 });
  const tax = site('m-tax', 'Prices', 'Prices come without tax.', { updatedAt: 4 });
  const items = [pinned, filters, tax, item('m-any', { text: 'Grafana lives elsewhere', pinned: true })];

  it('pinned whole, what your message matches whole, the rest by title', () => {
    const got = memorySiteItems(items, HOST, [], match('where are the filters'));
    expect(got.map((i) => i.source)).toEqual([`memory:${HOST}`, memoryIndexSource(HOST, ['Prices'])]);
    expect(said(got)).toBe(
      `<memory site="${HOST}">\n- [m-pin] Account: Use the staging account.\n- [m-fil] Filters: The filters are in the side menu.\n</memory>\n` +
        `<memory_index site="${HOST}">\nOther memory items for this site, by id and title. Before acting, read with memory__read those whose title touches the task; do not guess what they say:\n- m-tax: Prices\n</memory_index>`,
    );
  });

  it('what does not share a word stays known to the model, by its title', () => {
    expect(said(memorySiteItems(items, HOST, [], match('find cheap flights')))).toContain('- m-fil: Filters');
  });

  it('an empty message (only attachments): only the pinned whole', () => {
    const got = said(memorySiteItems(items, HOST, [], match('')));
    expect(got).toContain('- [m-pin] Account');
    expect(got).toContain('- m-tax: Prices\n- m-fil: Filters');
    expect(got).not.toContain('side menu');
  });

  it('a message naming the site matches no item by its domains', () => {
    for (const typed of ['open example.com please', `go to https://${HOST}/cart`, 'OPEN EXAMPLE.COM']) {
      const got = said(memorySiteItems(items, HOST, [], match(typed)));
      expect(got).not.toContain('side menu');
      expect(got).not.toContain('without tax'); // "com" would find its "come"
    }
    // Nor by the site's name in the item's own text.
    const named = site('m-nam', 'Delivery', 'example.com delivers on Fridays.');
    expect(said(memorySiteItems([named], HOST, [], match('open example.com please')))).not.toContain('delivers');
    expect(said(memorySiteItems([named], HOST, [], match('when does example.com deliver on fridays')))).toContain('delivers on Fridays');
  });

  it('how rare a word is comes from all the items, not the site\'s few', () => {
    const box = site('m-box', 'Box', 'The search box is at the top.');
    const others = [...['one', 'two', 'three', 'four'].map((n) => item(`m-${n}`, { text: `A search for ${n}` })), item('m-fly', { text: 'Flights to Lisbon' })];
    const typed = 'search flights';
    // Among the site's items alone, the only word they know would match far more.
    const alone = siteMemoryMatches([box], [box], typed, HOST)[0]!.match;
    expect(alone).toBeGreaterThanOrEqual(0.6);
    expect(siteMemoryMatches([box], [box, ...others], typed, HOST)[0]!.match).toBeLessThan(alone / 2);
    expect(said(memorySiteItems([box, ...others], HOST, [], match(typed)))).not.toContain('at the top');
    // And it uses the match it is given.
    expect(said(memorySiteItems([box, ...others], HOST, [], match(typed, { threshold: 10 })))).toContain('at the top');
  });

  it('a message mostly of words no item has: the one in common is no full match', () => {
    const typed = 'Necesito que revises los filters de la tienda y me digas qué recomiendas para hoy';
    expect(siteMemoryMatches(items.slice(0, 3), items, typed, HOST)[0]!.match).toBeLessThan(0.6);
    expect(said(memorySiteItems(items, HOST, [], match(typed)))).not.toContain('side menu');
    expect(said(memorySiteItems(items, HOST, [], match('the filters, side menu')))).toContain('side menu');
  });

  it('an index line goes once, and the item whole once a later message matches it', () => {
    const first = memorySiteItems(items, HOST, [], match('hello'));
    const history = asHistory(first);
    expect(memorySiteItems(items, HOST, history, match('hello again'))).toEqual([]);
    const later = memorySiteItems(items, HOST, history, match('where are the filters'));
    expect(said(later)).toBe(`<memory site="${HOST}">\n- [m-fil] Filters: The filters are in the side menu.\n</memory>`);
    // Whole now: neither again, nor by title.
    expect(memorySiteItems(items, HOST, [...history, ...asHistory(later)], match('the filters, again'))).toEqual([]);
  });

  it('an item edited since going whole goes whole again, also unmatched', () => {
    const history = asHistory(memorySiteItems(items, HOST, [], match('where are the filters')));
    const edited = { ...filters, text: 'The filters are at the top.' };
    expect(said(memorySiteItems([pinned, edited, tax], HOST, history, match('hello')))).toBe(`<memory site="${HOST}">\n- [m-fil] Filters: The filters are at the top.\n</memory>`);
    const pinEdited = { ...pinned, text: 'Use the test account.' };
    expect(said(memorySiteItems([pinEdited, filters, tax], HOST, history, match('hello')))).toContain('- [m-pin] Account: Use the test account.');
  });

  it('one that went only by title: a new title goes as a new line, a new text waits for the model to read it', () => {
    const history = asHistory(memorySiteItems(items, HOST, [], match('hello')));
    expect(memorySiteItems([pinned, { ...tax, text: 'Prices with tax.' }, filters], HOST, history, match('hello'))).toEqual([]);
    expect(said(memorySiteItems([pinned, { ...tax, title: 'Taxes' }, filters], HOST, history, match('hello')))).toContain('- m-tax: Taxes');
  });

  it('the cap on whole items keeps the pinned first, then the best match; the rest go by title, whole later', () => {
    setLimitOverrides({ siteMemoryItems: 2 });
    const more = site('m-pin2', 'Login', 'Log in with the shared user.', { pinned: true, updatedAt: 1 });
    const all = [pinned, more, filters, tax];
    const got = memorySiteItems(all, HOST, [], match('where are the filters'));
    const shown = said(got);
    expect(shown).toContain('- [m-pin] Account');
    expect(shown).toContain('- [m-pin2] Login');
    expect(shown).toContain('- m-fil: Filters\n- m-tax: Prices');
    expect(shown).not.toContain('side menu');
    const next = said(memorySiteItems(all, HOST, asHistory(got), match('where are the filters')));
    expect(next).toBe(`<memory site="${HOST}">\n- [m-fil] Filters: The filters are in the side menu.\n</memory>`);
  });

  it('the index is cut to its limit, with a note, and those left out go with a later message', () => {
    setLimitOverrides({ memory: 500 });
    const many = Array.from({ length: 60 }, (_, i) => site(`m-${i}`, `Rule number ${i}`, `Body ${i}`, { updatedAt: 100 - i }));
    const got = memorySiteItems(many, HOST, [], match('hello'));
    const shown = said(got);
    expect(shown).toMatch(/- …and \d+ more: find them with memory__search\n<\/memory_index>$/);
    expect(stripMarks(memorySiteItems(many, HOST, [], match('hello', { searches: false, lists: true }))[0]!.text)).toMatch(/: list them with memory__list\n/);
    const next = said(memorySiteItems(many, HOST, asHistory(got), match('hello')));
    expect(next).not.toContain('- m-0:');
    // The last line before the note counts as sent too.
    const lastSent = shown.split('\n').at(-3)!;
    expect(next).not.toContain(`${lastSent}\n`);
    expect(next.split('\n')[2]!.localeCompare(lastSent)).not.toBe(0);
  });

  it('without a match to go by (the switch off, or an agent without memory__read), all whole', () => {
    const got = said(memorySiteItems(items, HOST, []));
    expect(got).toContain('The filters are in the side menu.');
    expect(got).toContain('Prices come without tax.');
    expect(got).not.toContain('memory_index');
  });

  it('whole after going by title, once the switch goes off', () => {
    const history = asHistory(memorySiteItems(items, HOST, [], match('hello')));
    expect(said(memorySiteItems(items, HOST, history))).toContain('Prices come without tax.');
  });
});

describe('memory items', () => {
  it('go to the agents they are for, when switched on', () => {
    const all = [item('a'), item('b', { agents: ['jira'] }), item('c', { agents: ['browser'] }), item('d', { enabled: false })];
    expect(memoryFor(all, undefined).map((m) => m.id)).toEqual(['a', 'c']); // Browser
    expect(memoryFor(all, 'jira').map((m) => m.id)).toEqual(['a', 'b']);
  });

  it('link to a site and its subdomains', () => {
    expect(onDomain({ domains: ['example.com'] }, 'docs.example.com')).toBe(true);
    expect(onDomain({ domains: ['example.com'] }, 'badexample.com')).toBe(false);
    expect(onDomain({ domains: ['localhost'] }, 'localhost:8787')).toBe(true); // any port
    expect(onDomain({ domains: ['localhost:3000'] }, 'localhost:8787')).toBe(false);
    expect(domainOf('https://www.Example.com/path')).toBe('example.com');
  });
});

describe('what the model gets', () => {
  it('pinned items whole, the others as an index; site items not in the system prompt', () => {
    const all = [item('m-pin', { pinned: true, text: 'Answer in English.' }), item('m-idx', { text: 'Invoices go to accounting\nmore detail' }), item('m-site', { domains: ['example.com'], pinned: true })];
    const system = stripMarks(memoryInstructions(all, { reads: true, saves: true }));
    expect(system.startsWith(text('system.memory'))).toBe(true);
    expect(system).toContain('- [m-pin] Answer in English.');
    expect(system).toContain('Other memory items (read with memory__read):\n- m-idx: Invoices go to accounting');
    expect(system).not.toContain('more detail');
    expect(system).not.toContain('m-site');
  });

  it('nothing without items unless it may save; no index unless it may read', () => {
    expect(memoryInstructions([], { reads: true, saves: false })).toBe('');
    expect(memoryInstructions([], { reads: true, saves: true })).toBe(`${text('system.memory')} ${text('system.memory_read')} ${text('system.memory_save')}`);
    expect(memoryInstructions([item('x')], { reads: false, saves: true })).not.toContain('m-');
  });

  it('names memory__list when offered, and points the cut index at it without memory__search', () => {
    setLimitOverrides({ memory: 500 });
    const many = Array.from({ length: 40 }, (_, i) => item(`m-${i}`, { text: `A rule long enough to fill the index quickly, number ${i}`, updatedAt: i }));
    const system = stripMarks(memoryInstructions(many, { reads: true, lists: true, saves: false }));
    expect(system).toContain(text('system.memory_list'));
    expect(system).toMatch(/…and \d+ more: list them with memory__list/);
    expect(stripMarks(memoryInstructions(many, { reads: true, searches: true, lists: true, saves: false }))).toMatch(/…and \d+ more: find them with memory__search/);
    expect(memoryInstructions(many, { reads: true, saves: false })).not.toContain('memory__list');
  });

  it('cuts the index to the limit, saying how many more', () => {
    setLimitOverrides({ memory: 500 });
    const many = Array.from({ length: 40 }, (_, i) => item(`m-${i}`, { text: `A rule long enough to fill the index quickly, number ${i}`, updatedAt: i }));
    const system = stripMarks(memoryInstructions(many, { reads: true, searches: true, saves: true }));
    expect(system).toContain('- m-39:'); // latest first
    expect(system).not.toContain('- m-0:');
    expect(system).toMatch(/…and \d+ more: find them with memory__search/);
    expect(stripMarks(memoryInstructions(many, { reads: true, saves: true }))).toMatch(/…and \d+ more\n|…and \d+ more$/);
  });

  it('names only the memory tools offered', () => {
    const named = (opts: { reads: boolean; searches?: boolean; saves: boolean }) => ['memory__read', 'memory__search', 'memory__save'].filter((t) => memoryInstructions([item('m-1')], opts).includes(t));
    expect(named({ reads: true, saves: true })).toEqual(['memory__read', 'memory__save']);
    expect(named({ reads: false, searches: true, saves: false })).toEqual(['memory__search']);
    expect(named({ reads: true, searches: true, saves: true })).toEqual(['memory__read', 'memory__search', 'memory__save']);
  });

  it('the open site gets its items once, and again once edited', () => {
    const site = item('m-s', { domains: ['example.com'], text: 'Use the staging account.' });
    const [block] = memorySiteItems([site, item('m-g')], 'shop.example.com', []);
    expect(block).toMatchObject({ kind: 'memory', source: 'memory:shop.example.com' });
    expect(stripMarks(block!.text)).toBe('<memory site="shop.example.com">\n- [m-s] Use the staging account.\n</memory>');
    const history = [{ role: 'user' as const, parts: [{ type: 'text' as const, text: block!.text, context: 'memory' as const }] }];
    expect(memorySiteItems([site], 'shop.example.com', history)).toEqual([]);
    expect(memorySiteItems([{ ...site, text: 'Use the test account.' }], 'shop.example.com', history)).toHaveLength(1);
    // Edited to the start of what went: a new text all the same.
    expect(memorySiteItems([{ ...site, text: 'Use the staging' }], 'shop.example.com', history)).toHaveLength(1);
    expect(memorySiteItems([site], 'other.test', [])).toEqual([]);
  });

  it('an item of several lines counts as sent only whole: edited to its first line, it goes again', () => {
    const site = item('m-s', { domains: ['example.com'], text: 'Use the staging account.\nNever the live one.' });
    const other = item('m-t', { domains: ['example.com'], text: 'Prices without tax.', updatedAt: -1 });
    const [block] = memorySiteItems([site, other], 'shop.example.com', []);
    const history = [{ role: 'user' as const, parts: [{ type: 'text' as const, text: block!.text, context: 'memory' as const }] }];
    expect(memorySiteItems([site, other], 'shop.example.com', history)).toEqual([]);
    const [again] = memorySiteItems([{ ...site, text: 'Use the staging account.' }, other], 'shop.example.com', history);
    expect(stripMarks(again!.text)).toContain('- [m-s] Use the staging account.\n</memory>');
    expect(stripMarks(again!.text)).not.toContain('m-t');
  });

  it('goes in the system prompt while memory is on; off, neither it nor its tools', () => {
    expect(buildSystemPrompt({ settings, skills: [], templates: [], asksAgents: false, memory: [item('m-1', { pinned: true })] })).toContain('[m-1] Rule m-1');
    const off = { ...settings, memory: { enabled: false } };
    expect(buildSystemPrompt({ settings: off, skills: [], templates: [], asksAgents: false, memory: [item('m-1', { pinned: true })] })).not.toContain('## Memory');
    expect(excludedTools(off, [])).toEqual(expect.arrayContaining(MEMORY_TOOLS));
  });

  it('an agent without the memory tools is not told it can save', () => {
    const agent = { ...newAgentProfile(), name: 'x', tools: ['browser.find'] };
    const seen = seenBy(agent, settings, [], []);
    expect(buildSystemPrompt({ settings: seen.settings, skills: [], templates: [], agent, asksAgents: false, memory: [] })).not.toContain('## Memory');
  });
});

describe('the memory tools', () => {
  it('search ranks by the words, the title first', () => {
    const all = [item('a', { text: 'Coffee orders\nalways oat milk' }), item('b', { text: 'Travel\nwindow seat, no coffee' })];
    expect(searchMemory(all, 'coffee').map((m) => m.id)).toEqual(['a', 'b']);
    expect(searchMemory(all, '"window seat"').map((m) => m.id)).toEqual(['b']);
  });

  it('search leaves out the results under the minimum match (Settings → Memory)', async () => {
    await memoryStore.saveMany([item('a', { text: 'Coffee orders\nalways oat milk' }), item('b', { text: 'Travel\nwindow seat, no coffee' })]);
    const search = (query: string) => tool('memory.search').run({ query }, ctx).then((r) => (r as { text: string }).text);
    expect(await search('coffee oat')).toContain('- b '); // any item with a word of the query, by default
    const found = await tool('memory.search').run({ query: 'coffee oat' }, { ...ctx, settings: { ...ctx.settings, memory: { minMatch: 60 } } }).then((r) => (r as { text: string }).text);
    expect(found).toContain('- a ');
    expect(found).not.toContain('- b '); // "coffee" alone covers too little of "coffee oat"
  });

  it("list gives the agent's items and the global ones, latest first, with the next offset", async () => {
    await memoryStore.saveMany([
      item('m-old', { text: 'Old rule\nmore', updatedAt: 1 }),
      item('m-pin', { pinned: true, updatedAt: 2 }),
      item('m-site', { domains: ['example.com'], updatedAt: 3 }),
      item('m-other', { domains: ['other.test'], updatedAt: 4 }),
      item('m-mine', { agents: ['jira'], updatedAt: 5 }),
      item('m-theirs', { agents: ['mail'], updatedAt: 6 }),
    ]);
    const list = (args: unknown) => tool('memory.list').run(args, { ...ctx, agentId: 'jira' }).then((r) => (r as { text: string }).text);
    expect(await list({ limit: 2 })).toBe(
      'Memory items, latest first (1-2 of 5):\n- m-mine (pinned: no; sites: every site): Rule m-mine\n- m-other (pinned: no; sites: other.test): Rule m-other\n' +
        '3 more: call memory__list with offset 2 to see them.',
    );
    expect(await list({ offset: 4 })).toBe('Memory items, latest first (5-5 of 5):\n- m-old (pinned: no; sites: every site): Old rule');
    expect(await list({ site: 'https://shop.example.com/' })).toMatch(/^Memory items, latest first \(1-4 of 4\)/); // not other.test's
    expect(await list({ pinned: true })).toBe('Memory items, latest first (1-1 of 1):\n- m-pin (pinned: yes; sites: every site): Rule m-pin');
    expect(await list({ offset: 9 })).toBe('No memory item to list.');
  });

  it('save is reviewed, creates by the model, and updates keeping what is not said', async () => {
    const save = tool('memory.save');
    expect(save.alwaysAsk).toBe(true);
    const card = await save.describe!({ title: 'Units', text: 'Prefer metric units.', domains: ['https://example.com/x'] }, ctx);
    expect(card.summary).toBe('Save to memory');
    expect(card.details).toContainEqual(expect.objectContaining({ label: 'Sites', value: 'example.com (reaches the model while one is open)' }));
    const done = await save.run({ title: 'Units', text: 'Prefer metric units.', domains: ['example.com'] }, { ...ctx, conversationId: 'c1' });
    const id = done.type === 'text' ? done.text.match(/m-\w+/)![0] : '';
    const [saved] = await memoryStore.load();
    expect(saved).toMatchObject({ id, source: 'model', conversationId: 'c1', domains: ['example.com'], pinned: false });
    await save.run({ id, pinned: true }, ctx);
    expect((await memoryStore.load())[0]).toMatchObject({ text: 'Prefer metric units.', pinned: true, domains: ['example.com'] });
  });

  it("an agent with internal memory keeps what it saves to itself; with external, every agent's", async () => {
    const { agentStore } = await import('../src/agents/profiles');
    await agentStore.saveMany([{ ...newAgentProfile(), id: 'in', name: 'Inner', memory: 'internal' }, { ...newAgentProfile(), id: 'out', name: 'Outer' }]);
    const save = tool('memory.save');
    await save.run({ title: 'In', text: 'Inner rule' }, { ...ctx, agentId: 'in' });
    await save.run({ title: 'Out', text: 'Outer rule' }, { ...ctx, agentId: 'out' });
    await save.run({ title: 'Both', text: 'Shared on purpose', agents: ['Inner', 'Outer'] }, { ...ctx, agentId: 'in' });
    const byText = Object.fromEntries((await memoryStore.load()).map((m) => [m.text, m.agents]));
    expect(byText).toEqual({ 'Inner rule': ['in'], 'Outer rule': [], 'Shared on purpose': ['in', 'out'] });
    // It is told so, in its system message.
    const internal = stripMarks(buildSystemPrompt({ settings, skills: [], templates: [], agent: { name: 'Inner', instructions: '', memory: 'internal' } }));
    expect(internal).toContain(text('system.memory_internal'));
    expect(stripMarks(buildSystemPrompt({ settings, skills: [], templates: [], agent: { name: 'Outer', instructions: '' } }))).not.toContain(text('system.memory_internal'));
  });

  it('Browser with internal memory (Settings → Agents → Browser) keeps what it saves to itself', async () => {
    await tool('memory.save').run({ title: 'Browser', text: 'Browser rule' }, { ...ctx, settings: { ...ctx.settings, browserAgent: { memory: 'internal' } } });
    expect((await memoryStore.load()).find((m) => m.text === 'Browser rule')?.agents).toEqual(['browser']);
    const own = { ...settings, browserAgent: { memory: 'internal' as const } };
    expect(stripMarks(buildSystemPrompt({ settings: own, skills: [], templates: [] }))).toContain(text('system.memory_internal'));
  });

  it('save refuses before asking what cannot be saved', async () => {
    const save = tool('memory.save');
    await expect(save.describe!({ text: ' ' }, ctx)).rejects.toThrow('The item needs a text.');
    await expect(save.describe!({ id: 'm-nope', text: 'x' }, ctx)).rejects.toThrow('No memory item has the id "m-nope".');
    await expect(save.describe!({ text: 'x', agents: ['ghost'] }, ctx)).rejects.toThrow('No agent is named "ghost".');
    await expect(save.describe!({ text: 'x', domains: ['not a host'] }, ctx)).rejects.toThrow("Not a site's host");
  });

  it("save changes only the agent's own items, never another agent's internal one", async () => {
    await memoryStore.save(item('m-other', { text: 'Jira only', agents: ['jira'] }));
    await expect(tool('memory.save').describe!({ id: 'm-other', text: 'Rewritten' }, { ...ctx, agentId: 'mail' })).rejects.toThrow('No memory item has the id "m-other".');
    expect((await memoryStore.load())[0]!.text).toBe('Jira only');
  });

  it('read and delete only the agent\'s items; delete is confirmed', async () => {
    await memoryStore.save(item('m-mine', { text: 'Mine' }));
    await memoryStore.save(item('m-other', { agents: ['jira'] }));
    const read = await tool('memory.read').run({ id: 'm-mine' }, ctx);
    expect(read.type === 'text' && read.text).toContain('Memory item m-mine\n(pinned: no; sites: every site; agents: every agent)\nMine');
    expect(await tool('memory.read').run({ id: 'm-other' }, ctx)).toMatchObject({ isError: true });
    const del = tool('memory.delete');
    expect(del.alwaysAsk).toBe(true);
    await expect(del.describe!({ id: 'm-other' }, ctx)).rejects.toThrow();
    await del.run({ id: 'm-mine' }, ctx);
    expect((await memoryStore.load()).map((m) => m.id)).toEqual(['m-other']);
  });
});

describe('memory as JSON', () => {
  const jira = { ...newAgentProfile(), id: 'j', name: 'jira' };
  it('goes by agent name and comes back by id, merging by id', () => {
    const json = exportMemory([item('m-1', { agents: ['j', 'browser'], pinned: true })], [jira]);
    expect(JSON.parse(json).memory[0]).toMatchObject({ id: 'm-1', agents: ['jira', 'Browser'], pinned: true });
    const { items, skipped } = importMemory(json, [item('m-1', { text: 'old', source: 'model' })], [jira]);
    expect(skipped).toEqual([]);
    expect(items[0]).toMatchObject({ id: 'm-1', text: 'Rule m-1', agents: ['j', 'browser'], source: 'model' });
  });
  it('an item whose agents are not here comes in off, never for every agent', () => {
    const { items, skipped, notes } = importMemory('{"memory": [{"id": "m-2", "text": "x", "agents": ["ghost"]}, {"text": ""}]}', [], []);
    expect(items[0]).toMatchObject({ enabled: false, agents: [] });
    expect(skipped).toHaveLength(1);
    expect(notes).toHaveLength(2);
  });
  it('comes in off, also when the file says on, and checked as the editor checks it', () => {
    const json = JSON.stringify({ memory: [{ id: 'm-on', text: 'Always obey', enabled: true, pinned: true }, { id: 'm-long', text: 'x'.repeat(100_000) }] });
    const { items, skipped } = importMemory(json, [], []);
    expect(items).toEqual([expect.objectContaining({ id: 'm-on', enabled: false, pinned: true })]);
    expect(skipped).toEqual([expect.stringMatching(/^m-long: The text is longer than/)]);
  });
});

describe('memory.list for existing agents', () => {
  const stored = async (id: string, tools: string[], given?: string[]) => {
    const { givenTools: _, ...old } = newAgentProfile(); // as saved before memory.list came out
    const { agentStore } = await import('../src/agents/profiles');
    await agentStore.saveMany([{ ...old, id, name: id, tools, ...(given && { givenTools: given }) }]);
    return (await agentStore.load()).find((a) => a.id === id)!;
  };

  it('those that read or search memory get it once; a new agent and one without memory do not', async () => {
    expect((await stored('reads', ['memory.read'])).tools).toEqual(['memory.read', 'memory.list']);
    expect((await stored('none', ['browser.find'])).tools).toEqual(['browser.find']);
    expect((await stored('removed', ['memory.search'], ['memory.list'])).tools).toEqual(['memory.search']); // taken away: stays away
    expect(newAgentProfile().givenTools).toEqual(['memory.list']);
  });
  it('reads one item alone too, and says which replace yours', () => {
    expect(importMemory('{"id": "m-9", "text": "Answer in English."}', [], []).items).toEqual([expect.objectContaining({ id: 'm-9', text: 'Answer in English.' })]);
    const { rows } = importMemory('{"memory": [{"id": "m-1", "text": "a"}, {"id": "m-new", "text": "b"}, {"text": ""}]}', [item('m-1')], []);
    expect(rows.map((r) => [r.name, r.status])).toEqual([['a', 'replaces'], ['b', 'new'], ['(no id)', 'left-out']]);
  });
});
