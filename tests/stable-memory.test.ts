import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { stripMarks, text } = await import('../src/core/model-texts');
const { appendContext, keepSystemMemory } = await import('../src/core/messages');
const { buildSystemPrompt, memoryPromptOptions } = await import('../src/context/request');
const { seenWhole } = await import('../src/context/compaction');
const { MEMORY_CHANGES_SOURCE } = await import('../src/context/sources');
const { keepMemory, keptMemory, memoryChanges, memoryInstructions } = await import('../src/memory/prompt');
const { newMemoryItem } = await import('../src/memory/store');
type MemoryItem = import('../src/memory/store').MemoryItem;
type Message = import('../src/core/types').Message;

// The system prompt keeps the memory a conversation started with; what changed since goes with your messages, once.
const item = (id: string, change: Partial<MemoryItem> = {}): MemoryItem => ({ ...newMemoryItem([], { text: `Rule ${id}`, ...change }), id, updatedAt: change.updatedAt ?? 1 });
const opts = { reads: true, saves: true };
const ask = (t: string): Message => ({ role: 'user', parts: [{ type: 'text', text: t }] });
const blockOf = (items: { text: string }[]) => stripMarks(items[0]?.text ?? '');

describe('the memory a conversation keeps', () => {
  const start = [item('m-pin', { pinned: true, text: 'Answer in English.' }), item('m-idx'), item('m-gone'), item('m-site', { domains: ['example.com'] })];
  const kept = keepMemory(start, opts, 'k');

  it('is the system prompt part as built, with the items it covers as they were', () => {
    expect(kept.text).toBe(memoryInstructions(start, opts));
    expect(kept.items.map((e) => e.id).sort()).toEqual(['m-gone', 'm-idx', 'm-pin']); // not the site's
    const settings = { providers: [], systemPrompt: 'Be brief.' };
    expect(buildSystemPrompt({ settings, skills: [], templates: [], memory: [item('m-new')], memoryText: kept.text })).toContain(kept.text);
  });

  it('is found on the latest message keeping one, while built the same way', () => {
    const history = keepSystemMemory([ask('one'), { role: 'assistant', parts: [] }], kept);
    expect(history[0]!.systemMemory).toBe(kept);
    expect(keptMemory([...history, ask('two')], 'k')).toBe(kept);
    expect(keptMemory(history, 'other')).toBeUndefined(); // another agent, or memory tools switched: built again
    expect(keptMemory([ask('one')], 'k')).toBeUndefined();
  });

  it('says what changed since: saved or edited (pinned whole), deleted; not what is unchanged', () => {
    const now = [item('m-pin', { pinned: true, text: 'Answer in Spanish.', updatedAt: 2 }), item('m-idx'), item('m-new', { text: 'New rule\ndetail' }), item('m-site', { domains: ['example.com'], updatedAt: 5 })];
    const changes = memoryChanges(now, kept, opts, []);
    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({ kind: 'memory', source: MEMORY_CHANGES_SOURCE });
    const lines = blockOf(changes).split('\n');
    expect(lines[0]).toBe('<memory_changes>');
    expect(lines).toContain('- [m-pin] Answer in Spanish.');
    expect(lines).toContain('- m-new: New rule');
    expect(lines).toContain(text('memory.deleted_item', { memory_id: 'm-gone' }));
    expect(lines.join('\n')).not.toContain('m-idx');
    expect(lines.join('\n')).not.toContain('m-site');
    expect(memoryChanges(start, kept, opts, [])).toEqual([]);
  });

  it('sends each change once, and again once a summary left it out', () => {
    const now = [...start.filter((m) => m.id !== 'm-gone'), item('m-new')];
    const first = memoryChanges(now, kept, opts, []);
    const history = appendContext([ask('two')], first);
    expect(memoryChanges(now, kept, opts, seenWhole(history))).toEqual([]);
    // One more change: only that one goes.
    const later = memoryChanges([...now, item('m-third')], kept, opts, seenWhole(history));
    expect(blockOf(later)).toContain('m-third');
    expect(blockOf(later)).not.toContain('m-new');
    // Summarized away: what the model sees no longer has it.
    const summarized: Message[] = [...history, { role: 'assistant', parts: [] }, { ...ask('three'), compaction: { at: 1, turns: 1, trimmed: { pages: true, toolResults: true, screenshots: true }, summary: 'S', before: 1, after: 1 } }];
    expect(blockOf(memoryChanges(now, kept, opts, seenWhole(summarized)))).toContain('m-new');
  });

  it('is none while memory is off, and for EmptyAgent', () => {
    const settings = { providers: [], systemPrompt: '' };
    expect(memoryPromptOptions(settings)).toEqual({ reads: true, searches: true, lists: true, saves: true, internal: false });
    expect(memoryPromptOptions({ ...settings, memory: { enabled: false } })).toBeUndefined();
    expect(memoryPromptOptions(settings, { id: 'empty', name: 'EmptyAgent', instructions: '' })).toBeUndefined();
    expect(memoryPromptOptions({ ...settings, disabledTools: ['memory.read'] })).toMatchObject({ reads: false });
  });
});
