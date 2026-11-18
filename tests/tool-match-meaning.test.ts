// Tools matched by meaning (tools/match-meaning, tools/tool-index), against a mocked embeddings endpoint:
// each tool embedded once by the indexer, in batches, never on a message's path; a message's vector asked
// once per turn with memory's; a group goes by its closest tool; a failure only a notice.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';

const state = vi.hoisted(() => ({ records: new Map<string, unknown>(), access: true }));
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
vi.mock('../src/memory/vector-db', () => ({
  vectorDb: () => ({
    read: async () => [...state.records.values()],
    write: async (rs: { itemId: string }[]) => rs.forEach((r) => state.records.set(r.itemId, r)),
    delete: async () => undefined,
  }),
  readVectors: async () => [],
}));
vi.mock('../src/page/access', () => ({ hasAccess: async () => state.access }));
vi.mock('../src/word-blacklist/store', () => ({ loadBlacklist: async () => undefined }));

const { toolMeaning } = await import('../src/tools/match-meaning');
const { syncToolIndex } = await import('../src/tools/tool-index');
const { embedQuery } = await import('../src/memory/query-meaning');
const { decideToolMatch, matchGroups, recommendationItem } = await import('../src/tools/match');

const provider = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
const settings = { providers: [provider], memory: { semantic: { enabled: true, providerId: 'p1', model: 'embed' } } } as unknown as Settings;
const tool = (name: string, description: string, group: string) => ({ name, description, source: 'mcp' as const, group, inputSchema: {}, effect: 'read' as const });
const groups = matchGroups([
  tool('mcp.tasks.find_tasks', 'Finds tasks by text.', 'mcp:tasks'),
  tool('mcp.tasks.add_tasks', 'Adds tasks to a project.', 'mcp:tasks'),
  tool('mcp.tasks.find_projects', 'Lists the projects.', 'mcp:tasks'),
  tool('mcp.auto.find_drafts', 'Finds automation drafts.', 'mcp:auto'),
  tool('mcp.auto.list_workspaces', 'Lists the workspaces.', 'mcp:auto'),
  tool('mcp.auto.find_runs', 'Finds the runs of an automation.', 'mcp:auto'),
]);
// A vector per text: the message "crea una tarea" and add_tasks point the same way; the others away.
const vectorOf = (input: string) => (input.includes('add tasks') || input.includes('tarea') ? [1, 0, 0] : input.includes('find tasks') ? [0, 1, 0] : [0, 0, 1]);
const answering = () => vi.fn(async (_url: string, init: RequestInit) => {
  const { input } = JSON.parse(init.body as string) as { input: string[] };
  return new Response(JSON.stringify({ data: input.map((s, index) => ({ index, embedding: vectorOf(s) })) }));
});
const inputs = (fetch: ReturnType<typeof answering>) => fetch.mock.calls.map((c) => (JSON.parse(c[1].body as string) as { input: string[] }).input);

beforeEach(() => {
  state.records.clear();
  state.access = true;
});
afterEach(() => vi.unstubAllGlobals());

describe('tools by meaning', () => {
  it('are embedded by the indexer, once, each with its group and words; a message sends only itself', async () => {
    const fetch = answering();
    vi.stubGlobal('fetch', fetch);
    // Nothing indexed: by words only, nothing sent.
    expect(await toolMeaning(settings, 'crea una tarea', groups)).toEqual({ unindexed: 6 });
    expect(fetch).not.toHaveBeenCalled();
    expect(await syncToolIndex(settings, groups)).toEqual({ indexed: 6, total: 6 });
    // Its own name and description, not its server's name, which every tool of a server would share.
    expect(inputs(fetch)[0]!.slice(0, 2)).toEqual(['find tasks\nFinds tasks by text.', 'add tasks\nAdds tasks to a project.']);
    expect(await syncToolIndex(settings, groups)).toEqual({ indexed: 6, total: 6 });
    expect(fetch).toHaveBeenCalledTimes(1);
    // A message: only its vector; a group goes by its closest tool.
    const turn = {};
    await embedQuery(provider, 'embed', 'crea una tarea', turn); // as memory asks it
    const { meaning, unindexed } = await toolMeaning(settings, 'crea una tarea', groups, turn);
    expect(unindexed).toBe(0);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(meaning!.scores).toEqual(new Map([['mcp:tasks', 1], ['mcp:auto', 0]]));
    // add_tasks stands out from the six (2.2 spreads over their mean): the cuts, relative to it.
    expect(meaning!.cut!.matching).toBeCloseTo(1 - 1.5 * Math.sqrt(5) / 6, 5);
    expect(meaning!.cut!.recommend).toBeCloseTo(1 - 0.5 * Math.sqrt(5) / 6, 5);
    // Recommended by meaning: its closest tools first.
    const m = decideToolMatch({ mode: 'recommend', threshold: 40, typed: 'crea una tarea', groups, always: [], history: [{ role: 'user', parts: [{ type: 'text', text: 'crea una tarea' }] }], mentioned: [], meaning });
    expect(m.groups.map((g) => [g.id, g.outcome, g.meaning])).toEqual([['mcp:tasks', 'matched', 100], ['mcp:auto', 'unmatched', 0]]);
    expect(recommendationItem(m, groups)!.text).toContain('- MCP · tasks: mcp__tasks__add_tasks, ');
  });

  it('holds more with Hold more, reads an earlier build\u2019s level as the nearest, and offers when nothing stands out', async () => {
    vi.stubGlobal('fetch', answering());
    await syncToolIndex(settings, groups);
    const at = (match: object) => ({ ...settings, tools: { match } }) as unknown as Settings;
    const cut = async (match: object) => (await toolMeaning(at(match), 'crea una tarea', groups)).meaning!.cut!.matching;
    const spread = Math.sqrt(5) / 6;
    expect(await cut({})).toBeCloseTo(1 - 1.5 * spread, 5); // Offer more, the default
    expect(await cut({ level: 'balanced' })).toBeCloseTo(1 - spread, 5);
    expect(await cut({ level: 'hold-more' })).toBeCloseTo(1 - 0.5 * spread, 5);
    expect(await cut({ meaningLevel: 'strict' })).toBeCloseTo(1 - 0.5 * spread, 5); // an earlier build's Strict: Hold more
    expect(await cut({ meaningLevel: 'broad' })).toBeCloseTo(1 - 1.5 * spread, 5);
    // A message that stands out from nothing (every tool as close): Only matching offers, nothing is recommended.
    const flat = { scores: new Map([['mcp:tasks', 0.5], ['mcp:auto', 0.5]]), tools: new Map(groups.flatMap((g) => g.tools.map((t) => [t, 0.5] as [string, number]))) };
    const decide = (mode: 'recommend' | 'matching') => decideToolMatch({ mode, threshold: 40, typed: 'hola', groups, always: [], history: [{ role: 'user', parts: [{ type: 'text', text: 'hola' }] }], mentioned: [], meaning: flat });
    expect(decide('matching').groups.map((g) => g.outcome)).toEqual(['unsure', 'unsure']);
    expect(decide('matching').unsure).toBe(true);
    expect(decide('recommend').groups.map((g) => g.outcome)).toEqual(['unmatched', 'unmatched']);
  });

  it('send nothing with Semantic search off, and fail to words with no access or an error', async () => {
    vi.stubGlobal('fetch', answering());
    await syncToolIndex(settings, groups);
    const fetch = answering();
    vi.stubGlobal('fetch', fetch);
    expect(await toolMeaning({ ...settings, memory: {} } as Settings, 'crea una tarea', groups)).toEqual({});
    state.access = false;
    expect(await toolMeaning(settings, 'crea una tarea', groups)).toEqual({ failed: true, unindexed: 0 });
    expect(await syncToolIndex(settings, [...groups, ...matchGroups([tool('mcp.x.y', 'New.', 'mcp:x')])])).toMatchObject({ indexed: 6, total: 7, error: expect.stringContaining('No access') });
    expect(fetch).not.toHaveBeenCalled();
    state.access = true;
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    expect(await toolMeaning(settings, 'crea una tarea', groups)).toMatchObject({ failed: true });
  });
});
