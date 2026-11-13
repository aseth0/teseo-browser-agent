// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '../src/entrypoints/sidepanel/useAgent';
import type { Settings } from '../src/storage/settings';
import type { SettingsUpdate } from '../src/ui/useSettings';

// Going on with the last conversation, once it is loaded: it reads the conversation and settings of
// then, not those of the panel's first render.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let loaded!: () => void;
let deleted!: (ids: string[]) => void;
const latest = { id: 'c1', updatedAt: Date.now(), history: [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }], agentId: 'a1' };
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
vi.mock('../src/history/store', () => ({
  listConversations: async () => [latest],
  loadConversation: () => new Promise((resolve) => (loaded = () => resolve(latest))),
  saveConversation: vi.fn(async () => true),
  onConversationsDeleted: (cb: (ids: string[]) => void) => ((deleted = cb), () => undefined),
}));
vi.mock('../src/entrypoints/sidepanel/AgentPicker', () => ({ useActiveAgent: () => ({ agents: [], agent: undefined }) }));
const { useHistory } = await import('../src/entrypoints/sidepanel/useHistory');
const { noLive } = await import('../src/entrypoints/sidepanel/agent-store');
const { saveConversation } = await import('../src/history/store');

const agent = (history: unknown[]) => ({ conversationId: 'new', history, live: noLive('new'), busy: false, open: vi.fn(), reset: vi.fn(), stop: vi.fn() }) as unknown as Agent;
const settings = (change: Partial<Settings>) => ({ providers: [], history: { enabled: true, resume: 'recent' }, ...change }) as unknown as Settings;

function Probe(props: { agent: Agent; settings: Settings; onChange: SettingsUpdate; temporary?: string }) {
  useHistory(props.agent, props.settings, { tabId: 1, url: 'https://example.com/', access: 'ok' } as never, props.onChange, (id) => id === props.temporary);
  return null;
}

describe('resuming the last conversation', () => {
  it('keeps the settings changed meanwhile', async () => {
    const root = createRoot(document.createElement('div'));
    const onChange = vi.fn();
    const empty = agent([]);
    await act(async () => root.render(createElement(Probe, { agent: empty, settings: settings({}), onChange })));
    await act(async () => root.render(createElement(Probe, { agent: empty, settings: settings({ includePage: false }), onChange })));
    await act(async () => loaded());
    expect(empty.open).toHaveBeenCalledWith('c1', latest.history);
    // Only the agent changes: what changed meanwhile stays (useSettings applies it on the latest).
    expect(onChange).toHaveBeenCalledWith({ activeAgentId: 'a1' });
    act(() => root.unmount());
  });

  it('leaves alone a conversation started meanwhile', async () => {
    const root = createRoot(document.createElement('div'));
    const onChange = vi.fn();
    const first = agent([]);
    const started = agent([{ role: 'user', parts: [] }]);
    await act(async () => root.render(createElement(Probe, { agent: first, settings: settings({}), onChange })));
    await act(async () => root.render(createElement(Probe, { agent: started, settings: settings({}), onChange })));
    await act(async () => loaded());
    expect(first.open).not.toHaveBeenCalled();
    expect(started.open).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});

describe('saving a turn', () => {
  const turn = async (temporary?: string) => {
    const root = createRoot(document.createElement('div'));
    const said = [{ role: 'user', parts: [] }];
    const off = settings({ history: { enabled: true, resume: 'never' } });
    await act(async () => root.render(createElement(Probe, { agent: { ...agent(said), busy: true } as Agent, settings: off, onChange: vi.fn(), temporary })));
    await act(async () => root.render(createElement(Probe, { agent: agent(said), settings: off, onChange: vi.fn(), temporary })));
    act(() => root.unmount());
  };
  it('saves it, unless its conversation is temporary', async () => {
    vi.mocked(saveConversation).mockClear();
    await turn('new');
    expect(saveConversation).not.toHaveBeenCalled();
    await turn();
    expect(saveConversation).toHaveBeenCalledWith(expect.objectContaining({ id: 'new', talkedTo: { name: '🌐 Browser' } }), expect.anything(), { checked: false }); // checked only floating on a page
  });
});

describe('deleting the conversation shown', () => {
  it('starts a new one, and never saves the deleted one again', async () => {
    vi.mocked(saveConversation).mockClear();
    const root = createRoot(document.createElement('div'));
    const said = [{ role: 'user', parts: [] }];
    const off = settings({ history: { enabled: true, resume: 'never' } });
    const running = { ...agent(said), busy: true } as Agent;
    await act(async () => root.render(createElement(Probe, { agent: running, settings: off, onChange: vi.fn() })));
    act(() => deleted(['other']));
    expect(running.reset).not.toHaveBeenCalled();
    act(() => deleted(['new']));
    expect(running.stop).toHaveBeenCalled();
    expect(running.reset).toHaveBeenCalled();
    // Its turn ends after all (or the panel still holds it): not saved back.
    await act(async () => root.render(createElement(Probe, { agent: agent(said), settings: off, onChange: vi.fn() })));
    expect(saveConversation).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
