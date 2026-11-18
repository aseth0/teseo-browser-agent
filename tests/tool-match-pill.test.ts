// The pill under your message for tool matching (ui/chat/AttachedChips toolMatchGroups): what it says, and
// what its list shows per group; none when nothing was matched.
import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { toolMatchGroups } = await import('../src/ui/chat/AttachedChips');
type ToolMatch = import('../src/core/types').ToolMatch;

const group = (id: string, mode: 'recommend' | 'matching', outcome: ToolMatch['groups'][number]['outcome'], more: object = {}) =>
  ({ id, label: id.startsWith('mcp:') ? `MCP · ${id.slice(4)}` : id, mode, match: 0, meaning: 60, outcome, ...more });
const match = (groups: ToolMatch['groups']): ToolMatch => ({ mode: 'all', threshold: 40, groups, always: ['browser'] });

describe('the tool matching pill', () => {
  it('names the groups recommended, and counts those offered and held', () => {
    const [pill] = toolMatchGroups(match([
      group('mcp:tasks', 'recommend', 'matched', { tools: ['mcp.tasks.add-tasks', 'mcp.tasks.find-tasks', 'mcp.tasks.find-projects', 'mcp.tasks.search'] }),
      group('mcp:automation', 'matching', 'held'),
      group('web', 'matching', 'earlier'),
    ]));
    expect(pill!.pill).toBe('Recommended: tasks · 1 offered · 1 held');
    expect(pill!.icon).toBe('tool');
    expect(pill!.entries[0]).toEqual({ text: 'MCP · tasks', note: 'recommended when it matches · recommended · words 0% · meaning 60% · add-tasks, find-tasks, find-projects…' });
    expect(pill!.entries[1]!.note).toBe('only when it matches · held: listed in tools.load · words 0% · meaning 60%');
    expect(pill!.entries[2]!.note).toContain('offered: offered earlier in the conversation');
  });

  it('shows held groups even when none matched, and nothing when only recommendations missed', () => {
    expect(toolMatchGroups(match([group('mcp:automation', 'matching', 'held')]))[0]!.pill).toBe('0 offered · 1 held');
    expect(toolMatchGroups(match([group('mcp:tasks', 'recommend', 'unmatched')]))).toEqual([]);
    expect(toolMatchGroups(undefined)).toEqual([]);
  });

  it('reads an older record without a mode per group by the record’s mode', () => {
    const old = { mode: 'recommend', threshold: 40, groups: [{ id: 'web', label: 'Web', match: 50, outcome: 'matched' }], always: [] } as unknown as ToolMatch;
    expect(toolMatchGroups(old)[0]!.pill).toBe('Recommended: Web');
  });

  it('says when it went by words only, and when nothing stood out so nothing was held', () => {
    const [pill] = toolMatchGroups({ ...match([group('mcp:automation', 'matching', 'unsure')]), wordsOnly: true, unsure: true });
    expect(pill!.label).toBe('Tool matching (by words only): nothing stood out, so nothing was held');
    expect(pill!.pill).toBe('1 offered · 0 held');
    expect(pill!.entries[0]!.note).toContain('offered: nothing stood out for this message');
  });
});
