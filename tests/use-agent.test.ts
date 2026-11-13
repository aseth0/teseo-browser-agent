// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '../src/entrypoints/sidepanel/useAgent';

// The agent's actions keep one identity for the panel's life, and still act on the latest state.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const posted: unknown[] = [];
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: {
      connect: () => ({
        postMessage: (msg: unknown) => posted.push(msg),
        disconnect: () => {},
        onMessage: { addListener: () => {} },
        onDisconnect: { addListener: () => {} },
      }),
    },
  },
}));
const { useAgent } = await import('../src/entrypoints/sidepanel/useAgent');

const seen: Agent[] = [];
function Probe(_: { tick: number }) {
  seen.push(useAgent());
  return null;
}
const opts = { providerId: 'p', model: 'm', includePage: false, noSelection: false };

describe('useAgent', () => {
  it('keeps its actions, and the agent object while its state stays', async () => {
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe, { tick: 0 })));
    await act(async () => root.render(createElement(Probe, { tick: 1 })));
    expect(seen.at(-1)).toBe(seen.at(-2)); // a re-render of the parent alone
    const first = seen.at(-1)!;
    await act(async () => first.send('Hi', opts));
    const after = seen.at(-1)!;
    expect(after).not.toBe(first);
    expect(after.history).toHaveLength(1);
    for (const name of ['send', 'resume', 'regenerate', 'stop', 'respond', 'respondAccess', 'respondUser', 'reset', 'open', 'compact', 'setCompacting', 'dismissPlan'] as const) expect(after[name]).toBe(first[name]);
    act(() => root.unmount());
  });

  it('acts on the latest state through an action kept from the first render', async () => {
    seen.length = 0;
    posted.length = 0;
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe, { tick: 0 })));
    const kept = seen[0]!;
    await act(async () => kept.send('One', opts));
    await act(async () => kept.stop());
    // The second goes on from the first (not from the empty history of the first render).
    await act(async () => kept.send('Two', opts));
    const runs = posted.filter((m) => (m as { type: string }).type === 'run') as { history: unknown[]; conversationId: string }[];
    expect(runs.at(-1)!.history).toHaveLength(2);
    expect(runs.at(-1)!.conversationId).toBe(seen.at(-1)!.conversationId);
    // A turn running: opening another conversation stops it first.
    expect(seen.at(-1)!.busy).toBe(true);
    await act(async () => kept.open('other', []));
    expect(posted.map((m) => (m as { type: string }).type).slice(-2)).toEqual(['stop', 'attach']);
    expect(seen.at(-1)!.conversationId).toBe('other');
    expect(seen.at(-1)!.busy).toBe(false);
    act(() => root.unmount());
  });

  it('drops a send or a compaction meant for a conversation no longer open', async () => {
    seen.length = 0;
    posted.length = 0;
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe, { tick: 0 })));
    const agent = seen[0]!;
    await act(async () => agent.send('Hi', opts));
    await act(async () => agent.stop());
    const first = seen.at(-1)!.conversationId;
    const before = seen.at(-1)!.history;
    // Worked out for the first conversation; another was opened meanwhile (e.g. while compacting).
    await act(async () => agent.open('other', []));
    let sent = true;
    await act(async () => {
      sent = agent.send('Late', { ...opts, conversationId: first });
    });
    expect(sent).toBe(false);
    await act(async () => void agent.compact(0, { at: 1, turns: 1, trimmed: { pages: true, toolResults: true, screenshots: true }, before: 1, after: 1 }, first));
    expect(seen.at(-1)!.conversationId).toBe('other');
    expect(seen.at(-1)!.history).toEqual([]);
    expect(before).toHaveLength(1);
    // Meant for the one open: it goes.
    await act(async () => {
      sent = agent.send('Now', { ...opts, conversationId: 'other' });
    });
    expect(sent).toBe(true);
    act(() => root.unmount());
  });

  it('runs nothing while a turn runs or the earlier turns are being compacted', async () => {
    seen.length = 0;
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe, { tick: 0 })));
    const agent = seen[0]!;
    await act(async () => agent.send('Hi', opts));
    let sent = true;
    await act(async () => {
      sent = agent.send('Again', opts);
    });
    expect(sent).toBe(false);
    expect(seen.at(-1)!.history).toHaveLength(1);
    await act(async () => agent.stop());
    await act(async () => {
      agent.setCompacting(true);
      sent = agent.send('While compacting', opts);
    });
    expect(sent).toBe(false);
    await act(async () => {
      agent.setCompacting(false);
      sent = agent.send('After', opts);
    });
    expect(sent).toBe(true);
    act(() => root.unmount());
  });

  it('sees what was dispatched just before, in the same task, before any render', async () => {
    seen.length = 0;
    posted.length = 0;
    const root = createRoot(document.createElement('div'));
    await act(async () => root.render(createElement(Probe, { tick: 0 })));
    const agent = seen[0]!;
    await act(async () => {
      agent.send('Hi', opts);
      agent.open('other', []); // the turn just started is stopped first
    });
    expect(posted.map((m) => (m as { type: string }).type)).toEqual(['view', 'run', 'stop', 'attach']); // view: whether the chat shows, as its port opens
    await act(async () => {
      agent.reset();
      agent.send('One', opts);
      agent.stop();
      agent.send('Two', opts); // goes on from 'One', in the conversation reset just before
    });
    const run = posted.at(-1) as { history: unknown[]; conversationId: string };
    expect(run.history).toHaveLength(2);
    expect(run.conversationId).toBe(seen.at(-1)!.conversationId);
    expect(run.conversationId).not.toBe('other');
    act(() => root.unmount());
  });
});
