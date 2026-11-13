// What goes once per conversation (site skills, memory, auto-attach) goes again once compaction trimmed
// or summarized the copy the model had: judged on what it still sees whole (context/compaction seenWhole).
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { ALL_PARTS, seenWhole } = await import('../src/context/compaction');
const { shortenRun, inRunOf } = await import('../src/context/in-run');
const { siteContextItems } = await import('../src/context/site-context');
const { stepAttachItems } = await import('../src/context/step-attach');
const { historyAutoSource, bookmarkAutoSource } = await import('../src/context/sources');
const { historyPicks } = await import('../src/history/auto');
const { bookmarkPicks } = await import('../src/bookmarks/auto');
const { appendContext } = await import('../src/core/messages');
const { stripMarks } = await import('../src/core/model-texts');
type Message = import('../src/core/types').Message;
type Compaction = import('../src/core/types').Compaction;
type Skill = import('../src/skills/types').Skill;
type MemoryItem = import('../src/memory/store').MemoryItem;
type Settings = import('../src/storage/settings').Settings;
type Conversation = import('../src/history/store').Conversation;
type Bookmark = import('../src/bookmarks/store').Bookmark;

const URL = 'https://shop.test/cart';
const skill: Skill = { id: 'shop', name: 'shop', description: 'd', matches: ['*://shop.test/*'], body: 'SHOP-RULE-7', references: [], enabled: true };
const item = (id: string, text: string, change: Partial<MemoryItem> = {}): MemoryItem =>
  ({ id, enabled: true, text, pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1, ...change }) as MemoryItem;
const memory = [item('m-site', 'Use the guest checkout', { domains: ['shop.test'], pinned: true }), item('m-graf', 'Grafana lives at grafana.example.test')];
const settings = { memory: { autoAttach: { enabled: true, threshold: 60, steps: true } } } as Partial<Settings> as Settings;
const conv = { id: 'c-lamp', title: 'Which lamp is cheapest', createdAt: 1, updatedAt: 1, turns: 1, history: [] } as Partial<Conversation> as Conversation;
const bookmark: Bookmark = { id: 'b-pie', title: 'Lemon pie', url: 'https://food.example.com/lemon-pie', path: '' };
const on = { enabled: true, threshold: 0 };

const user = (typed: string): Message => ({ role: 'user', parts: [{ type: 'text', text: typed }] });
const reply = (t: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text: t }] });
const site = (typed: string, history: Message[]) => siteContextItems({ settings, skills: [skill], templates: [], memory, memoryOpts: { reads: true, saves: true }, url: URL, typed, history: seenWhole(history) });

// Turn 1 got the site skill's block, the site's memory, the memory your message matched, a saved
// conversation and a bookmark on their own (long enough to be trimmed); turn 2 a reminder.
function twoTurns(): Message[] {
  const first = appendContext([user('grafana please')], [
    ...site('grafana please', [user('grafana please')]).items,
    { kind: 'page', source: historyAutoSource(conv.id, 80, conv.title), text: 'transcript '.repeat(100) },
    { kind: 'page', source: bookmarkAutoSource(bookmark.id, 80, bookmark.title), text: 'bookmark '.repeat(100) },
  ]);
  const turn1 = [...first, reply('one')];
  const second = appendContext([...turn1, user('more')], site('more', [...turn1, user('more')]).items);
  return [...second, reply('two')];
}
const compaction = (summary?: string): Compaction => ({ at: 1, turns: 1, trimmed: ALL_PARTS, before: 0, after: 0, ...(summary && { summary }) });
// The next message, with a compaction on turn 2's message (it trims or summarizes turn 1).
function compactedThen(c: Compaction | undefined, typed = 'grafana again'): Message[] {
  const h = twoTurns();
  const at = h.findIndex((m, i) => i > 0 && m.role === 'user');
  return [...h.map((m, i) => (i === at && c ? { ...m, compaction: c } : m)), user(typed)];
}
const texts = (items: { text: string }[]) => items.map((i) => stripMarks(i.text)).join('\n');
const picks = (history: Message[]) => ({
  history: historyPicks([{ conv, match: 0.9 }], 'lamp', seenWhole(history), on).picks.length,
  bookmark: bookmarkPicks([{ bookmark, match: 0.9 }], 'pie', seenWhole(history), on).length,
});

describe('once per conversation, as the model sees it', () => {
  it('not compacted: a reminder, nothing attached again', () => {
    const h = compactedThen(undefined);
    expect(seenWhole(h)).toBe(h);
    const said = texts(site('grafana again', h).items);
    expect(said).toContain('Still active');
    expect(said).not.toContain('SHOP-RULE-7');
    expect(said).not.toContain('guest checkout');
    expect(said).not.toContain('Grafana lives');
    expect(picks(h)).toEqual({ history: 0, bookmark: 0 });
  });

  it('compacted with trim: the skill and memory stay whole, the long auto-attached blocks go again', () => {
    const h = compactedThen(compaction());
    const said = texts(site('grafana again', h).items);
    expect(said).toContain('Still active');
    expect(said).not.toContain('SHOP-RULE-7');
    expect(said).not.toContain('guest checkout');
    expect(picks(h)).toEqual({ history: 1, bookmark: 1 });
  });

  it('compacted with a summary: the full skill block, the site memory and the matched memory again', () => {
    const h = compactedThen(compaction('SUMMARY'));
    const said = texts(site('grafana again', h).items);
    expect(said).toContain('<site_skill name="shop">\nSHOP-RULE-7');
    expect(said).not.toContain('Still active');
    expect(said).toContain('Use the guest checkout');
    expect(said).toContain('Grafana lives');
    expect(picks(h)).toEqual({ history: 1, bookmark: 1 });
    // Once sent again, after the summary: whole again, so not a third time.
    const again = appendContext(h, site('grafana again', h).items);
    const next = [...again, reply('three'), user('grafana still')];
    expect(texts(site('grafana still', next).items)).toContain('Still active');
    expect(texts(site('grafana still', next).items)).not.toContain('guest checkout');
  });

  it('between steps: what went after a result counts while whole, also once in-run shortened it', async () => {
    const steps = { memory: { autoAttach: { enabled: true, threshold: 60, steps: true } } } as Partial<Settings> as Settings;
    const [block] = await stepAttachItems('opening grafana', [user('go')], steps, memory);
    expect(stripMarks(block!.text)).toContain('Grafana lives');
    // Attached after a long result; three more results later the turn sends that one as a note.
    const call = (id: string): Message => ({ role: 'assistant', parts: [{ type: 'tool_call', id, name: 'browser.get_page_text', args: {} }] });
    const result = (id: string, content: string, attached?: typeof block): Message => ({
      role: 'tool',
      parts: [{ type: 'tool_result', toolCallId: id, content: attached ? `${content}\n\n${attached.text}` : content, ...(attached && { attached: [{ kind: attached.kind, text: attached.text, source: attached.source }] }) }],
    });
    const run: Message[] = [user('go'), call('c1'), result('c1', 'x'.repeat(2000), block), ...['c2', 'c3', 'c4'].flatMap((id) => [call(id), result(id, 'y'.repeat(2000))])];
    const shortened = shortenRun(run, inRunOf(undefined));
    expect(JSON.stringify(shortened[2])).toContain('Grafana lives'); // in-run keeps what went after it
    expect(await stepAttachItems('grafana again', run, steps, memory)).toEqual([]);
    // Summarized away by a compaction on a later message: it goes again.
    const summarized: Message[] = [...run, reply('done'), { ...user('next'), compaction: compaction('SUMMARY') }, call('c5'), result('c5', 'z')];
    expect(texts(await stepAttachItems('grafana again', summarized, steps, memory))).toContain('Grafana lives');
  });
});
