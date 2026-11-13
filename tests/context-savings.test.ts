import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { ALL_PARTS, compactionOf, compactionWindow, modelView } = await import('../src/context/compaction');
const { dedupeContext, dedupeOf, setDedupe } = await import('../src/context/dedupe');
const { inRunOf, repeatableAmong, repeatableIn, shortenRun } = await import('../src/context/in-run');
const { requestView } = await import('../src/context/request-view');
const { toCallViews } = await import('../src/ui/calls/calls');
const { runAgentLoop } = await import('../src/core/agent-loop');
const { fitWithin } = await import('../src/core/image');
const { limit, limitFrom, setLimitOverrides } = await import('../src/core/limits');
const { keepLatest, stripMarks, text } = await import('../src/core/model-texts');
const { ToolRegistry } = await import('../src/core/tool-registry');
const { memoryInstructions, memorySiteItems } = await import('../src/memory/prompt');
const { newMemoryItem } = await import('../src/memory/store');
const { pageTextChars } = await import('../src/tools/browser/read-tools');
const { collect, loop, scripted } = await import('./helpers');
type Message = import('../src/core/types').Message;
type Part = import('../src/core/types').Part;
type Compaction = import('../src/core/types').Compaction;
type MemoryItem = import('../src/memory/store').MemoryItem;

afterEach(() => {
  setLimitOverrides({});
  setDedupe(undefined);
});

const long = (c: string, n = 1000) => c.repeat(n);
const leftOut = (what: string, chars: number) => text('run.left_out', { what, chars: chars.toLocaleString('en-US') });
const call = (id: string, name = 'browser.get_page_text'): Message => ({ role: 'assistant', parts: [{ type: 'tool_call', id, name, args: {} }] });
const result = (id: string, content: string, extra: Partial<Extract<Part, { type: 'tool_result' }>> = {}): Message => ({ role: 'tool', parts: [{ type: 'tool_result', toolCallId: id, content, ...extra }] });
const contentOf = (messages: Message[], id: string) =>
  messages.flatMap((m) => m.parts).find((p): p is Extract<Part, { type: 'tool_result' }> => p.type === 'tool_result' && p.toolCallId === id)!;
const ask: Message = { role: 'user', parts: [{ type: 'text', text: 'read it all' }] };

describe('during a turn', () => {
  // Five results of a turn, the first four long.
  const turn: Message[] = [ask, ...[1, 2, 3, 4].flatMap((n) => [call(`c${n}`), result(`c${n}`, long(String(n)))]), call('c5'), result('c5', 'short')];

  it('sends the latest results whole and the earlier long ones as a note', () => {
    const sent = shortenRun(turn, inRunOf(undefined));
    expect(contentOf(sent, 'c1').content).toBe(leftOut('the result of browser__get_page_text', 1000));
    for (const id of ['c2', 'c3']) expect(contentOf(sent, id).content).toBe(leftOut('the result of browser__get_page_text', 1000));
    for (const id of ['c4', 'c5']) expect(contentOf(sent, id)).toBe(contentOf(turn, id)); // the latest 2
    expect(turn[2]!.parts[0]).toMatchObject({ content: long('1') }); // the history stays whole
  });

  it('keeps whole every result of the latest step, calls made in parallel, however many', () => {
    const parallel: Message = { role: 'assistant', parts: ['p1', 'p2', 'p3'].map((id) => ({ type: 'tool_call' as const, id, name: 'browser.get_page_text', args: {} })) };
    const results: Message = { role: 'tool', parts: ['p1', 'p2', 'p3'].map((id) => ({ type: 'tool_result' as const, toolCallId: id, content: long(id) })) };
    const sent = shortenRun([ask, call('c1'), result('c1', long('1')), parallel, results], inRunOf({ keepResults: 1 }));
    for (const id of ['p1', 'p2', 'p3']) expect(contentOf(sent, id).content).toBe(long(id));
    expect(contentOf(sent, 'c1').content).toBe(leftOut('the result of browser__get_page_text', 1000));
  });

  it('keeps whole the latest skill and reference read, the instructions being followed', () => {
    const turn: Message[] = [ask, call('s1', 'skills.load'), result('s1', long('s')), call('r1', 'skills.read_reference'), result('r1', long('r')), ...[1, 2, 3].flatMap((n) => [call(`c${n}`), result(`c${n}`, long(String(n)))])];
    const sent = shortenRun(turn, inRunOf(undefined));
    expect(contentOf(sent, 's1').content).toBe(long('s'));
    expect(contentOf(sent, 'r1').content).toBe(long('r'));
    expect(contentOf(sent, 'c1').content).toBe(leftOut('the result of browser__get_page_text', 1000));
  });

  it('keeps as many whole as keepResults says, within its range', () => {
    expect(contentOf(shortenRun(turn, inRunOf({ keepResults: 1 })), 'c4').content).toBe(leftOut('the result of browser__get_page_text', 1000));
    expect(contentOf(shortenRun(turn, inRunOf({ keepResults: 4 })), 'c2').content).toBe(long('2'));
    expect(inRunOf(undefined).keepResults).toBe(2);
    expect(inRunOf({ keepResults: 99 }).keepResults).toBe(15);
    expect(inRunOf({ keepResults: 0 }).keepResults).toBe(1);
  });

  it('sends whole an earlier result of a call not to be made again: a write, an agent\'s or the user\'s answer', () => {
    const tools = new ToolRegistry();
    const tool = (name: string, source: 'browser' | 'agent' | 'user' | 'custom', effect: 'read' | 'write' | 'interact') =>
      tools.register({ name, description: '', inputSchema: {}, source, effect, run: async () => ({ type: 'text', text: '' }) });
    tool('browser.get_page_text', 'browser', 'read');
    tool('shop.buy', 'custom', 'write');
    tool('agents.ask', 'agent', 'read');
    tool('user.ask', 'user', 'interact');
    const names = ['shop.buy', 'agents.ask', 'user.ask', 'browser.get_page_text'];
    const mixed: Message[] = [ask, ...names.flatMap((name, n) => [call(`m${n}`, name), result(`m${n}`, long(String(n)))]), ...[5, 6, 7].flatMap((n) => [call(`m${n}`), result(`m${n}`, 'short')])];
    const sent = shortenRun(mixed, inRunOf(undefined), { repeatable: repeatableIn(tools) });
    for (const id of ['m0', 'm1', 'm2']) expect(contentOf(sent, id)).toBe(contentOf(mixed, id));
    expect(contentOf(sent, 'm3').content).toBe(leftOut('the result of browser__get_page_text', 1000));
  });

  it('sends as a note, to be fetched again, the result of a write that says it may be repeated (web.read)', () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'web.read', description: '', inputSchema: {}, source: 'web', effect: 'write', repeatable: true, run: async () => ({ type: 'text', text: '' }) });
    tools.register({ name: 'web.show_user', description: '', inputSchema: {}, source: 'web', effect: 'write', run: async () => ({ type: 'text', text: '' }) });
    expect([repeatableIn(tools)('web.read'), repeatableIn(tools)('web.show_user')]).toEqual([true, false]);
    expect(repeatableAmong([{ name: 'web.read', effect: 'write', source: 'web', repeatable: true }])('web.read')).toBe(true);
    const mixed: Message[] = [ask, call('m0', 'web.read'), result('m0', long('0')), ...[1, 2, 3].flatMap((n) => [call(`m${n}`), result(`m${n}`, 'short')])];
    const sent = shortenRun(mixed, inRunOf(undefined), { repeatable: repeatableIn(tools) });
    expect(contentOf(sent, 'm0').content).toBe(leftOut('the result of web__read', 1000));
  });

  it('is what the Calls view shows of the turn\'s later calls, as the run sends it', () => {
    const settings = { providers: [], compaction: { inRun: { keepResults: 1 } } } as unknown as Parameters<typeof requestView>[0];
    const tools = [{ name: 'browser.get_page_text', effect: 'read' as const, source: 'browser' as const }, { name: 'shop.buy', effect: 'write' as const, source: 'custom' as const }];
    const repeatable = repeatableAmong(tools);
    expect([repeatable('browser.get_page_text'), repeatable('shop.buy'), repeatable('gone.tool')]).toEqual([true, false, true]);
    // By the wire name too, as the calls the model made have it.
    expect([repeatable('browser__get_page_text'), repeatable('shop__buy')]).toEqual([true, false]);
    const view = (system: string | undefined, history: Message[]) => requestView(settings, system, history, { repeatable });
    const [shown] = toCallViews([{ title: 'Call', why: '', history: turn, at: turn.length }], { system: 's', specs: [], head: {}, view });
    const sent = requestView(settings, 's', turn, { repeatable }).messages;
    expect(contentOf(sent, 'c4').content).toBe(leftOut('the result of browser__get_page_text', 1000));
    expect(shown!.clean.map((m) => m.content)).toContain(contentOf(sent, 'c4').content);
    expect(shown!.clean.map((m) => m.content)).not.toContain(long('4'));
  });

  it('sends whole an earlier result no longer than minChars', () => {
    const sent = shortenRun(turn, inRunOf({ minChars: 1000 }));
    expect(contentOf(sent, 'c1').content).toBe(long('1'));
    expect(contentOf(shortenRun(turn, inRunOf({ minChars: 999 })), 'c1').content).not.toBe(long('1'));
  });

  it('only shortens the latest turn, and keeps what went after a result between steps', () => {
    const attached = [{ kind: 'memory' as const, text: 'NOTE' }];
    const earlier: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'before' }] }, call('old'), result('old', long('o')), { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] }];
    const history = [...earlier, ask, call('a'), result('a', `${long('a')}\n\nNOTE`, { attached }), ...[1, 2, 3].flatMap((n) => [call(`b${n}`), result(`b${n}`, 'x')])];
    const sent = shortenRun(history, inRunOf(undefined));
    expect(contentOf(sent, 'old').content).toBe(long('o'));
    expect(contentOf(sent, 'a').content).toBe(`${leftOut('the result of browser__get_page_text', 1000)}\n\nNOTE`);
  });

  it('sends only the latest screenshot', () => {
    const shot = (data: string) => ({ images: [{ mediaType: 'image/jpeg', data }] });
    const history = [ask, call('s1', 'browser.screenshot'), result('s1', '[shot]', shot('AAAA')), call('s2', 'browser.screenshot'), result('s2', '[shot]', shot('BBBBBB'))];
    const sent = shortenRun(history, inRunOf(undefined));
    expect(contentOf(sent, 's1')).toEqual({ type: 'tool_result', toolCallId: 's1', content: `[shot]\n${leftOut('an earlier screenshot', 4)}` });
    expect(contentOf(sent, 's2').images).toEqual([{ mediaType: 'image/jpeg', data: 'BBBBBB' }]);
    expect(contentOf(shortenRun(history, inRunOf({ lastScreenshot: false })), 's1').images).toHaveLength(1);
  });

  it('sends only the latest page elements after an action', () => {
    const list = (n: number) => `- button "B${n}" [ref_${n}]`;
    const after = (n: number) => `Clicked.\nNow on: https://shop.test/\n${list(n)}\n`;
    const history = [ask, call('k1', 'browser.click'), result('k1', after(1)), call('k2', 'browser.click'), result('k2', after(2))];
    const elements = new Map([['k1', list(1)], ['k2', list(2)]]);
    // Both kept whole as results (short), but the first one's list goes as a note.
    const sent = shortenRun(history, inRunOf({ minChars: 5000 }), { elements });
    expect(contentOf(sent, 'k1').content).toBe(`Clicked.\nNow on: https://shop.test/\n${leftOut('the page elements after an earlier action', list(1).length)}\n`);
    expect(contentOf(sent, 'k2').content).toBe(after(2));
    expect(contentOf(shortenRun(history, inRunOf({ minChars: 5000, lastElements: false }), { elements }), 'k1').content).toBe(after(1));
  });

  it('sends everything as it is when off', () => {
    expect(shortenRun(turn, inRunOf({ enabled: false }))).toBe(turn);
  });

  it('is what the agent loop sends on its later steps, the history kept whole', async () => {
    const tools = new ToolRegistry();
    tools.register({ name: 'browser.click', description: 'click', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: `Clicked\nELEMENTS-${'e'.repeat(50)}`, elements: `ELEMENTS-${'e'.repeat(50)}` }) });
    const provider = scripted([0, 1].map((n) => [{ type: 'tool-call', id: `k${n}`, name: 'browser__click', args: {} }, { type: 'done', stopReason: 'tool_calls' }]));
    const { requests } = provider;
    const view = (system: string | undefined, messages: Message[], seen: { elements: ReadonlyMap<string, string> }) => modelView(system, shortenRun(messages, inRunOf(undefined), { elements: seen.elements }));
    const events = await collect(runAgentLoop([ask], loop(provider, tools, { context: { view } }), new AbortController().signal));
    const last = requests.at(-1)!.messages;
    expect(contentOf(last, 'k0').content).toBe(`Clicked\n${leftOut('the page elements after an earlier action', 59)}`);
    expect(contentOf(last, 'k1').content).toContain('ELEMENTS-');
    const kept = events.flatMap((e) => (e.type === 'message' && e.message.role === 'tool' ? e.message.parts : []));
    expect(kept[0]).toMatchObject({ content: `Clicked\nELEMENTS-${'e'.repeat(50)}` });
    expect(kept[0]).not.toHaveProperty('elements');
  });
});

const PAGE = (url: string, body: string) => `<untrusted_page_content url="${url}">\n${body}\n</untrusted_page_content>`;
const userWith = (q: string, ...context: Extract<Part, { type: 'text' }>[]): Message => ({ role: 'user', parts: [{ type: 'text', text: q }, ...context] });
const page = (url: string, body = long('p')) => ({ type: 'text' as const, context: 'page' as const, source: 'page-block', text: PAGE(url, body) });
const answer: Message = { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] };
const lastContext = (messages: Message[], source: string) => messages.at(-1)!.parts.find((p) => p.type === 'text' && p.source === source) as { text: string };

describe("don't resend what the model has seen", () => {
  const unchanged = (what: string) => text('context.unchanged', { what });

  it('sends a page the same as the last one as a note', () => {
    const history = [userWith('q1', page('https://shop.test/a')), answer, userWith('q2', page('https://shop.test/a'))];
    const sent = modelView(undefined, history).messages;
    expect(stripMarks(lastContext(sent, 'page-block').text)).toBe(unchanged('The page (https://shop.test/a)'));
    expect(lastContext(history, 'page-block').text).toBe(PAGE('https://shop.test/a', long('p'))); // the history keeps it
    // And again on the next one: the copy above is still whole.
    const third = modelView(undefined, [...history, answer, userWith('q3', page('https://shop.test/a'))]).messages;
    expect(stripMarks(lastContext(third, 'page-block').text)).toBe(unchanged('The page (https://shop.test/a)'));
  });

  it('sends the page whole when it changed, or when it is the same as an older one only', () => {
    const changed = [userWith('q1', page('https://shop.test/a')), answer, userWith('q2', page('https://shop.test/a', 'other'))];
    expect(lastContext(modelView(undefined, changed).messages, 'page-block').text).toBe(PAGE('https://shop.test/a', 'other'));
    const back = [...changed, answer, userWith('q3', page('https://shop.test/a'))];
    expect(lastContext(modelView(undefined, back).messages, 'page-block').text).toBe(PAGE('https://shop.test/a', long('p')));
  });

  it('sends it whole again once compaction trimmed or summarized the copy above', () => {
    const compaction = (c: Partial<Compaction> = {}): Compaction => ({ at: 1, turns: 1, trimmed: ALL_PARTS, before: 0, after: 0, ...c });
    const history = [userWith('q1', page('https://shop.test/a')), answer, { ...userWith('q2', page('https://shop.test/a')), compaction: compaction() }];
    expect(lastContext(modelView(undefined, history).messages, 'page-block').text).toBe(PAGE('https://shop.test/a', long('p')));
    const summarized = history.map((m, i) => (i === 2 ? { ...m, compaction: compaction({ summary: 'earlier' }) } : m));
    expect(lastContext(modelView(undefined, summarized).messages, 'page-block').text).toBe(PAGE('https://shop.test/a', long('p')));
    // Trimming only tool results leaves the page above whole: then the note.
    const toolsOnly = history.map((m, i) => (i === 2 ? { ...m, compaction: compaction({ trimmed: { ...ALL_PARTS, pages: false } }) } : m));
    expect(stripMarks(lastContext(modelView(undefined, toolsOnly).messages, 'page-block').text)).toBe(unchanged('The page (https://shop.test/a)'));
  });

  it('does the same for site template outputs and site skill values, each by its own', () => {
    const tpl = (t: string) => ({ type: 'text' as const, context: 'page' as const, source: 'template:shop/cart', text: t });
    const values = (t: string) => ({ type: 'text' as const, context: 'page' as const, source: 'skill-values:shop-buy', text: t });
    const history = [userWith('q1', tpl('cart: 2'), values('price: 3')), answer, userWith('q2', tpl('cart: 2'), values('price: 4'))];
    const sent = modelView(undefined, history).messages;
    expect(stripMarks(lastContext(sent, 'template:shop/cart').text)).toBe(unchanged('The output of the site template shop'));
    expect(lastContext(sent, 'skill-values:shop-buy').text).toBe('price: 4');
    const again = modelView(undefined, [...history, answer, userWith('q3', values('price: 4'))]).messages;
    expect(stripMarks(lastContext(again, 'skill-values:shop-buy').text)).toBe(unchanged('The values of the site skill shop-buy'));
  });

  it('sends everything whole with its switches off', () => {
    setDedupe({ page: false, siteValues: false, mentions: false });
    const history = [userWith('q1', page('https://shop.test/a')), answer, userWith('q2', page('https://shop.test/a'))];
    expect(modelView(undefined, history).messages).toEqual(history);
    expect(dedupeContext(history, dedupeOf({ page: false }))).toBe(history);
  });
});

describe('repeated mentions', () => {
  const attachedNote = (what: string) => text('context.already_attached', { what });
  const mention = (source: string, t: string, context: 'page' | 'skill' = 'page') => ({ type: 'text' as const, context, source, text: t });
  const conv = (t = long('c')) => mention('history-mention:trip:Trip plans', t);
  const bookmark = mention('bookmark-mention:docs:Docs', '- Docs https://docs.test/');
  const skill = mention('skill-mention:summarize', 'Skill summarize: do it', 'skill');

  it('go as a note when the same content is attached above', () => {
    const history = [userWith('q1', conv(), bookmark, skill), answer, userWith('q2', conv(), bookmark, skill)];
    const sent = modelView(undefined, history).messages;
    expect(stripMarks(lastContext(sent, 'history-mention:trip:Trip plans').text)).toBe(attachedNote('The conversation "Trip plans"'));
    expect(stripMarks(lastContext(sent, 'bookmark-mention:docs:Docs').text)).toBe(attachedNote('The bookmark "Docs"'));
    expect(stripMarks(lastContext(sent, 'skill-mention:summarize').text)).toBe(attachedNote('The skill summarize'));
  });

  it('go whole when their content changed, or the copy above was trimmed', () => {
    const changed = [userWith('q1', conv()), answer, userWith('q2', conv('newer'))];
    expect(lastContext(modelView(undefined, changed).messages, 'history-mention:trip:Trip plans').text).toBe('newer');
    const compaction: Compaction = { at: 1, turns: 1, trimmed: ALL_PARTS, before: 0, after: 0 };
    const trimmed = [userWith('q1', conv()), answer, { ...userWith('q2', conv()), compaction }];
    expect(lastContext(modelView(undefined, trimmed).messages, 'history-mention:trip:Trip plans').text).toBe(long('c'));
  });

  it('go whole with mentions off', () => {
    setDedupe({ mentions: false });
    const history = [userWith('q1', bookmark), answer, userWith('q2', bookmark)];
    expect(lastContext(modelView(undefined, history).messages, 'bookmark-mention:docs:Docs').text).toBe(bookmark.text);
  });
});

describe('the limits that save context', () => {
  it('screenshots: within the longest side set, 1568 px by default', () => {
    expect(limit('screenshotSize')).toBe(1568);
    expect(limitFrom('screenshotSize', 100)).toBe(512);
    expect(fitWithin(3136, 1960, limit('screenshotSize'))).toEqual({ width: 1568, height: 980, scale: 0.5 });
    expect(fitWithin(800, 600, 1568)).toEqual({ width: 800, height: 600, scale: 1 });
  });

  it('browser__get_page_text: the size asked for, at most the maximum', () => {
    expect(pageTextChars(undefined)).toBe(limit('pageText'));
    expect(pageTextChars(1000)).toBe(1000);
    expect(pageTextChars(10_000_000)).toBe(50000);
    setLimitOverrides({ pageTextMax: 8000 });
    expect(pageTextChars(10_000)).toBe(8000);
  });

  it('the text sent to summarize: its latest part, 60,000 characters by default', () => {
    expect(limit('summaryText')).toBe(60000);
    expect(keepLatest('short', 100)).toBe('short');
    const transcript = `${'old line\n'.repeat(100)}user: the latest`;
    const kept = keepLatest(transcript, 100);
    expect(kept.length).toBeLessThanOrEqual(100);
    expect(kept.endsWith('user: the latest')).toBe(true);
    expect(kept.startsWith('old line')).toBe(true); // from a line's start
  });

  const item = (id: string, change: Partial<MemoryItem> = {}): MemoryItem => ({ ...newMemoryItem([], { text: `Rule ${id}`, ...change }), id, updatedAt: change.updatedAt ?? 1 });

  it('pinned memory: in full within its size, the rest in the index', () => {
    setLimitOverrides({ pinnedMemory: 500 });
    const items = [item('a', { pinned: true, text: `A ${'a'.repeat(300)}`, updatedAt: 3 }), item('b', { pinned: true, text: `B ${'b'.repeat(300)}`, updatedAt: 2 })];
    const system = stripMarks(memoryInstructions(items, { reads: true, saves: true }));
    expect(system).toContain('a'.repeat(300));
    expect(system).not.toContain('b'.repeat(300));
    expect(system).toContain(stripMarks(text('memory.index_item', { memory_id: 'b', memory_title: 'B bbb' })).slice(0, 8)); // its id, listed
    expect(limit('pinnedMemory')).toBe(500);
    setLimitOverrides({});
    expect(limit('pinnedMemory')).toBe(8000);
    expect(stripMarks(memoryInstructions(items, { reads: true, saves: true }))).toContain('b'.repeat(300));
  });

  it('site memory items: at most 20 per message by default', () => {
    const items = Array.from({ length: 25 }, (_, i) => item(`s${i}`, { domains: ['shop.test'], updatedAt: i }));
    const [block] = memorySiteItems(items, 'shop.test', []);
    expect(stripMarks(block!.text).match(/- \[s/g)).toHaveLength(20);
    setLimitOverrides({ siteMemoryItems: 3 });
    expect(stripMarks(memorySiteItems(items, 'shop.test', [])[0]!.text).match(/- \[s/g)).toHaveLength(3);
  });
});

describe('the window for an unknown one', () => {
  it('is 72,000 tokens by default; 0: no compaction on its own', () => {
    expect(compactionOf(undefined).defaultWindow).toBe(72000);
    expect(compactionWindow(undefined, compactionOf(undefined))).toBe(72000);
    expect(compactionWindow(128000, compactionOf(undefined))).toBe(128000); // the model's, when known
    expect(compactionWindow(undefined, compactionOf({ defaultWindow: 0 }))).toBeUndefined();
    expect(compactionWindow(undefined, compactionOf({ defaultWindow: 32000 }))).toBe(32000);
  });
});
