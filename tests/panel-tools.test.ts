import { describe, expect, it, vi } from 'vitest';
import type { AgentProfile } from '../src/agents/profiles';
import { httpUrl, PANEL_TOOLS, panelToolsFor, rowsResult, wait, withPanel, type PanelPage } from '../src/agents/panel';
import type { ManagerStatus, PanelRow } from '../src/manager/protocol';
import { childrenOf, panelRowOf, rowsReducer, treeOf, type Row, type Rows } from '../src/manager/rows';
import { restoredOf, savedOf } from '../src/manager/saved';
import type { ToolContext } from '../src/core/types';

// The Agents Panel's tools (agents/panel) and the rows they make (manager/rows).
const reader = { id: 'reader', name: 'reader', description: 'Reads pages' } as AgentProfile;
const ctx = (signal = new AbortController().signal) => ({ signal }) as ToolContext;
const page = (over: Partial<PanelPage> = {}): PanelPage => ({ start: vi.fn(async () => ({ row: 'r1' })), rows: vi.fn(async () => []), send: vi.fn(async () => ({ when: 'now' as const })), ...over });
const tools = (p: PanelPage, sleep = vi.fn(async () => {})) => {
  const [start, wait, send] = panelToolsFor([reader], 'Browser', p, 1, sleep);
  return { start: start!, wait: wait!, send: send!, sleep };
};
const textOf = (r: unknown) => (r as { text: string }).text;

describe('which chats get them', () => {
  it('only a chat of the panel the user started, with an agent to start, and there in place of agents.ask', () => {
    const panel = PANEL_TOOLS.map((name) => ({ name }));
    const all = [{ name: 'browser.click' }, { name: 'agents.ask' }, ...panel];
    expect(withPanel(all, true)).toEqual([{ name: 'browser.click' }, ...panel]);
    expect(withPanel(all, false)).toEqual([{ name: 'browser.click' }, { name: 'agents.ask' }]);
  });
  it('panel.start is always confirmed; its agents are those that can be asked', () => {
    const { start } = tools(page());
    expect(start.alwaysAsk).toBe(true);
    expect(start.inputSchema).toMatchObject({ properties: { agent: { enum: ['reader'] } } });
    expect(start.fillDescription!('Agents you may start:\n{agent_list}')).toBe('Agents you may start:\n- reader: Reads pages');
  });
});

describe('panel.start', () => {
  it('starts the agent with its task, on the URL given', async () => {
    const p = page();
    expect(textOf(await tools(p).start.run({ agent: 'reader', task: ' compare prices ', url: 'https://shop.example.com/a' }, ctx()))).toBe(
      'Started reader in row r1 on https://shop.example.com/a. It works in parallel: call panel__wait for its answer.',
    );
    // The model gets who started it; the chat, and its row, show the task alone.
    expect(p.start).toHaveBeenCalledWith({ agent: reader, message: { text: 'The agent "Browser" started you in the Agents Panel: compare prices', shown: 'compare prices' }, url: 'https://shop.example.com/a', max: 1 });
  });
  it('refuses an agent it may not start, no task, a URL that is not http(s)', async () => {
    const { start } = tools(page());
    expect(await start.run({ agent: 'other', task: 't', url: 'https://example.com' }, ctx())).toMatchObject({ isError: true });
    expect(await start.run({ agent: 'reader', task: ' ', url: 'https://example.com' }, ctx())).toMatchObject({ isError: true });
    expect(textOf(await start.run({ agent: 'reader', task: 't', url: 'javascript:alert(1)' }, ctx()))).toBe('Give a full http or https URL for its tab.');
  });
  it('past the limit, and with no panel open', async () => {
    const refused = (n: number) => tools(page({ start: async () => ({ tooMany: n }) })).start.run({ agent: 'reader', task: 't', url: 'https://example.com' }, ctx());
    expect(textOf(await refused(1))).toBe('This conversation has started 1 agent, the most allowed (Settings → Limits): give it more work with panel__send, or wait for it.');
    expect(textOf(await refused(3))).toBe('This conversation has started 3 agents, the most allowed (Settings → Limits): give them more work with panel__send, or wait for them.');
    expect(textOf(await tools(page({ start: async () => undefined })).start.run({ agent: 'reader', task: 't', url: 'https://example.com' }, ctx()))).toBe(
      'The Agents Panel is not open: the agents started there stopped.',
    );
  });
});

describe('panel.wait', () => {
  const done: PanelRow = { row: 'r1', agent: 'reader', state: 'done', answer: 'Cheapest: the second.' };
  const working: PanelRow = { row: 'r1', agent: 'reader', state: 'working', step: 2, maxSteps: 15 };
  it('asks again until every row is settled, then gives the answers as untrusted', async () => {
    const rows = vi.fn().mockResolvedValueOnce([working]).mockResolvedValueOnce([done]);
    const { wait, sleep } = tools(page({ rows }));
    const out = textOf(await wait.run({}, ctx()));
    expect(rows).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(out).toContain('Row r1 · reader · done');
    expect(out).toContain('<untrusted_agent_answer agent="reader">');
    expect(out).toContain('Cheapest: the second.');
  });
  it('0 only checks: what still works says so', async () => {
    const { wait, sleep } = tools(page({ rows: async () => [working] }));
    const out = textOf(await wait.run({ wait_seconds: 0 }, ctx()));
    expect(sleep).not.toHaveBeenCalled();
    expect(out).toBe('Row r1 · reader · working (step 2/15)\n(Some are still working after 0 s: call panel__wait again, or go on.)');
  });
  it('a row it did not start', async () => {
    const out = textOf(await tools(page({ rows: async () => [done] })).wait.run({ rows: ['x'] }, ctx()));
    expect(out).toBe('No row x was started by you. Yours: r1.');
  });
  it('stops waiting when the turn is stopped', async () => {
    const stop = new AbortController();
    stop.abort();
    expect(textOf(await tools(page({ rows: async () => [working] })).wait.run({}, ctx(stop.signal)))).toContain('still working');
  });
  it('a row waiting for the user, or stopped, is settled', () => {
    expect(rowsResult([{ row: 'a', agent: 'x', state: 'waiting' }, { row: 'b', agent: 'y', state: 'stopped' }])).toBe('Row a · x · waiting for the user\nRow b · y · stopped');
  });
});

describe('panel.send', () => {
  it('gives the row a message from its caller', async () => {
    const p = page({ send: vi.fn(async () => ({ when: 'later' as const })) });
    expect(textOf(await tools(p).send.run({ row: 'r1', message: 'now the third' }, ctx()))).toBe('Sent to row r1: it reads it once its turn ends.');
    expect(p.send).toHaveBeenCalledWith('r1', { text: 'The agent "Browser" says: now the third', shown: 'now the third' });
  });
  it('a row it did not start, or nothing to say', async () => {
    expect(textOf(await tools(page({ send: async () => ({ noRow: ['r1'] }) })).send.run({ row: 'x', message: 'm' }, ctx()))).toBe('No row x was started by you. Yours: r1.');
    expect(await tools(page()).send.run({ row: 'r1', message: ' ' }, ctx())).toMatchObject({ isError: true });
  });
});

describe('the pause between asks', () => {
  it('takes its abort listener away when the time is up, and ends early on abort', async () => {
    const stop = new AbortController();
    const add = vi.spyOn(stop.signal, 'addEventListener');
    const remove = vi.spyOn(stop.signal, 'removeEventListener');
    await wait(1, stop.signal);
    expect(remove).toHaveBeenCalledWith('abort', add.mock.calls[0]![1]);
    const pending = wait(60_000, stop.signal);
    stop.abort();
    await pending; // it would time the test out otherwise
  });
});

describe('a URL for its tab', () => {
  it('only full http(s) ones', () => {
    expect(httpUrl(' https://example.com/a ')).toBe('https://example.com/a');
    expect([httpUrl('example.com'), httpUrl('file:///etc/hosts'), httpUrl(3)]).toEqual([undefined, undefined, undefined]);
  });
});

describe('the rows they make', () => {
  const status: ManagerStatus = { state: 'idle', said: true, conversationId: 'c', title: 't', step: 0, maxSteps: 15, agentName: 'reader', model: 'm', given: 0 };
  const task = { text: 'The agent "Browser" started you in the Agents Panel: task', shown: 'task' };
  const more = { text: 'The agent "Browser" says: more', shown: 'more' };
  const start = (rows: Rows, key: string, parent?: string) => rowsReducer(rows, { type: 'add', row: { key, tabId: 1, ...(parent && { parent, pending: [task] }) } });

  it('goes after its parent and the others it started, without taking the user away', () => {
    let s = start(start({ rows: [] }, 'a'), 'b');
    s = rowsReducer(s, { type: 'select', key: 'b' });
    s = start(s, 'a1', 'a');
    s = start(s, 'a2', 'a');
    expect(s.rows.map((r) => r.key)).toEqual(['a', 'a1', 'a2', 'b']);
    expect(s.selected).toBe('b');
    expect(childrenOf(s.rows, 'a').map((r) => r.key)).toEqual(['a1', 'a2']);
  });
  it('draws the tree: a parent, its rows (the last one apart), and rows on their own', () => {
    const rows = [{ key: 'a' }, { key: 'a1', parent: 'a' }, { key: 'a2', parent: 'a' }, { key: 'b' }, { key: 'c' }, { key: 'c1', parent: 'c' }].map((r) => ({ tabId: 1, ...r }));
    expect(rows.map((_, i) => treeOf(rows, i))).toEqual(['parent', 'child', 'last', undefined, 'parent', 'last']);
    const orphans = rows.slice(1, 3); // their parent removed
    expect(orphans.map((_, i) => treeOf(orphans, i))).toEqual([undefined, undefined]);
  });
  it('its messages wait for its chat, then are counted as handed', () => {
    let s = start(start({ rows: [] }, 'a'), 'a1', 'a');
    s = rowsReducer(s, { type: 'give', key: 'a1', message: more });
    expect(s.rows[1]!.pending).toEqual([task, more]);
    s = rowsReducer(s, { type: 'handed', key: 'a1', count: 2 });
    expect(s.rows[1]).toMatchObject({ pending: [], handed: 2 });
  });
  it('works until its chat sent all it was handed and its turn ended; then its answer', () => {
    const row: Row = { key: 'a1', tabId: 1, parent: 'a', agentName: 'reader' };
    expect(panelRowOf({ ...row, pending: [task] })).toMatchObject({ state: 'working', step: 0 });
    expect(panelRowOf({ ...row, handed: 1, status: { ...status, given: 0 } })).toMatchObject({ state: 'working' });
    expect(panelRowOf({ ...row, handed: 1, status: { ...status, state: 'working', given: 1, step: 3 } })).toMatchObject({ state: 'working', step: 3 });
    expect(panelRowOf({ ...row, handed: 1, status: { ...status, state: 'waiting', given: 1 } })).toEqual({ row: 'a1', agent: 'reader', state: 'waiting' });
    expect(panelRowOf({ ...row, handed: 1, status: { ...status, given: 1, answer: 'done it' } })).toEqual({ row: 'a1', agent: 'reader', state: 'done', answer: 'done it' });
    expect(panelRowOf({ ...row, stopped: true })).toEqual({ row: 'a1', agent: 'reader', state: 'stopped' });
  });
  it('keeps, and brings back, which row started it', () => {
    const kept = savedOf([{ key: 'a1', tabId: 1, conversationId: 'c', parent: 'a', parentName: 'Browser', pending: [task] }]);
    expect(kept).toEqual([{ key: 'a1', tabId: 1, conversationId: 'c', parent: 'a', parentName: 'Browser' }]);
    expect(restoredOf(kept, new Set(['c']))[0]).toMatchObject({ parent: 'a', parentName: 'Browser', stopped: true });
  });
});
