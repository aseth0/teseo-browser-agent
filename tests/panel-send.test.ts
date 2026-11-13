import { describe, expect, it, vi } from 'vitest';
import { giveToRow, type ResumeChecks } from '../src/manager/panel-send';
import { panelRowOf, rowsReducer, type Row, type Rows } from '../src/manager/rows';
import { panelToolsFor, type PanelPage } from '../src/agents/panel';
import type { ToolContext } from '../src/core/types';
import type { AgentProfile } from '../src/agents/profiles';

// panel.send to a row an agent started (manager/panel-send): a stopped one (the page was reloaded) goes on
// on its tab first, or the agent is told it cannot.
const message = { text: 'The agent "Browser" says: more', shown: 'more' };
const boss: Row = { key: 'p', tabId: 1 };
const stopped: Row = { key: 'w1', tabId: 7, parent: 'p', agentName: 'Builder', conversationId: 'c1', url: 'https://shop.example.com/a', title: 'compare prices', stopped: true };
const checks = (over: Partial<ResumeChecks> = {}): ResumeChecks => ({ tab: async (id) => ({ id, url: 'https://shop.example.com/b' }), held: async () => new Map(), ...over });
const run = async (row: Row, c: ResumeChecks, rows: Row[] = [boss, row]) => {
  let state: Rows = { rows, selected: 'p' };
  const dispatch = vi.fn((a: Parameters<typeof rowsReducer>[1]) => void (state = rowsReducer(state, a)));
  const out = await giveToRow(row, message, () => state.rows, dispatch, c);
  return { out, state };
};

describe('panel.send to a stopped row', () => {
  it('goes on on its tab, the user staying where they are, and gets the message once its chat is there', async () => {
    const { out, state } = await run(stopped, checks());
    expect(out).toEqual({ when: 'later' });
    expect(state.selected).toBe('p');
    const row = state.rows.find((r) => r.key === 'w1')!;
    expect(row).toMatchObject({ stopped: false, tabId: 7, pending: [message] });
    expect(panelRowOf(row).state).toBe('working');
  });
  it('cannot when its tab is closed, on another site, a live row\'s, or its conversation open elsewhere: says so by its title', async () => {
    const cases: [ResumeChecks, Row[]?][] = [
      [checks({ tab: async () => undefined })],
      [checks({ tab: async (id) => ({ id, url: 'https://other.example.com/' }) })],
      [checks({ held: async () => new Map([['c1', 'chat']]) })],
      [checks(), [boss, stopped, { key: 'q', tabId: 7 }]],
    ];
    for (const [c, rows] of cases) {
      const { out, state } = await run(stopped, c, rows);
      expect(out).toEqual({ stopped: 'compare prices' });
      expect(state.rows.find((r) => r.key === 'w1')).toMatchObject({ stopped: true });
      expect(state.rows.find((r) => r.key === 'w1')!.pending).toBeUndefined();
    }
  });
  it('a live row just gets it', async () => {
    const { out, state } = await run({ ...stopped, stopped: false }, checks({ tab: async () => undefined }));
    expect(out).toEqual({ when: 'later' });
    expect(state.rows[1]!.pending).toEqual([message]);
  });
  it('the agent is told, with the row and its title', async () => {
    const page: PanelPage = { start: vi.fn(), rows: vi.fn(), send: async () => ({ stopped: 'compare prices' }) };
    const send = panelToolsFor([{ id: 'b', name: 'Builder', description: 'd' } as AgentProfile], 'Browser', page, 3)[2]!;
    const out = await send.run({ row: 'w1', message: 'more' }, { signal: new AbortController().signal } as ToolContext);
    expect(out).toMatchObject({ isError: true });
    expect((out as { text: string }).text).toBe(
      'Row w1 ("compare prices") is stopped (the Agents Panel was reloaded) and cannot go on: its tab is closed or on another site, or its conversation is open in another chat. Start a new one with panel__start.',
    );
  });
});
