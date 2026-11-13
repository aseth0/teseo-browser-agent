// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Agent } from '../src/entrypoints/sidepanel/useAgent';
import type { Settings } from '../src/storage/settings';
import { fakeBrowser, fakeStorage } from './fakes/browser';

// The chat in the agent manager's page (sidepanel.html?tab=…&manager): what it leaves out, and what
// it keeps to itself. The mode is read when used, so a test can be the side panel instead.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const mode = { manager: true };
vi.mock('../src/ui/floating-frame', () => ({
  FLOATING: false,
  get MANAGER() {
    return mode.manager;
  },
  MANAGER_AGENT: 'a1',
  FULL: false,
  PREVIEW: false,
  floatingTab: async () => undefined,
  knownFloatingTab: () => undefined,
}));
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const listConversations = vi.fn(async () => [{ id: 'c1', updatedAt: Date.now(), history: [], agentId: 'a1' }]);
vi.mock('../src/history/store', async (real) => ({
  ...(await real<typeof import('../src/history/store')>()),
  listConversations,
  loadConversation: async () => ({ id: 'c1', history: [{ role: 'user', parts: [] }] }),
  saveConversation: vi.fn(async () => undefined),
  onConversationsDeleted: () => () => undefined,
}));
const siteAgents = [{ id: 'shop', enabled: true, name: 'shop', sites: { 'example.com': 'ask' } }];
vi.mock('../src/ui/useCollection', () => ({ useCollection: () => siteAgents, useCollectionState: () => ({ items: siteAgents, loaded: true }) }));

const { chatChrome } = await import('../src/entrypoints/sidepanel/modes');
const { useHandoff } = await import('../src/entrypoints/sidepanel/useHandoff');
const { HANDOFF_MS } = await import('../src/core/handoff');
const { isConversationPayload } = await import('../src/widget/protocol');
const useWidgetHandoff = (idle: boolean, take: Parameters<typeof useHandoff>[3]) => useHandoff(CHAT_HANDOFF, isConversationPayload, { waitMs: HANDOFF_MS, idle, tag: 'chat-handoff' }, take);
const { useHistory } = await import('../src/entrypoints/sidepanel/useHistory');
const { useSiteAgent } = await import('../src/entrypoints/sidepanel/AgentPicker');
const { CHAT_HANDOFF } = await import('../src/widget/protocol');

const agent = () => ({ conversationId: 'new', history: [], live: { get: () => ({ segments: [] }), subscribe: () => () => undefined }, busy: false, open: vi.fn(), reset: vi.fn(), stop: vi.fn() }) as unknown as Agent;
const settings = (change: Partial<Settings> = {}) => ({ providers: [], history: { enabled: true, resume: 'recent' }, ...change }) as unknown as Settings;
const page = { tabId: 1, url: 'https://example.com/', access: 'ok' } as never;

async function mount(probe: () => void) {
  const root = createRoot(document.createElement('div'));
  const Probe = () => (probe(), null);
  await act(async () => root.render(createElement(Probe)));
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  act(() => root.unmount());
}

beforeEach(() => {
  storage.reset();
  mode.manager = true;
});

describe('what a chat shows, by mode', () => {
  it('in the manager: no pin slot, watches, move or history button, and no agents button', () => {
    expect(chatChrome({ floating: false, manager: true, full: false, preview: false })).toEqual({ lead: false, watches: false, move: false, history: false, agents: false, voice: true });
  });
  it('the side panel keeps them all, and has the agents button', () => {
    expect(chatChrome({ floating: false, manager: false, full: false, preview: false })).toEqual({ lead: true, watches: true, move: true, history: true, agents: true, voice: true });
  });
  it('floating: no lead and no move (the widget has its own bar, with the move to the side panel)', () => {
    expect(chatChrome({ floating: true, manager: false, full: false, preview: false })).toEqual({ lead: false, watches: true, move: false, history: true, agents: false, voice: false });
  });
  it('full-screen in a tab: history and watches, no lead and no move', () => {
    expect(chatChrome({ floating: false, manager: false, full: true, preview: false })).toEqual({ lead: false, watches: true, move: false, history: true, agents: false, voice: true });
  });
  it('the Appearance preview: no dictation (nothing is sent from it)', () => {
    expect(chatChrome({ floating: false, manager: false, full: false, preview: true }).voice).toBe(false);
  });
});

describe('a manager chat leaves the other chats alone', () => {
  it('does not go on with the latest conversation', async () => {
    const a = agent();
    listConversations.mockClear();
    await mount(() => useHistory(a, settings(), page, vi.fn(), () => false));
    expect(listConversations).not.toHaveBeenCalled();
    expect(a.open).not.toHaveBeenCalled();
  });

  it('takes no handoff from the page widget', async () => {
    const handoff = { at: Date.now(), payload: { kind: 'conversation', messages: [] } };
    for (const manager of [true, false]) {
      mode.manager = manager;
      await storage.session.set({ [CHAT_HANDOFF]: handoff });
      const take = vi.fn();
      await mount(() => useWidgetHandoff(true, take));
      expect(take).toHaveBeenCalledTimes(manager ? 0 : 1);
    }
  });

  it('does not change to the agent of the site', async () => {
    for (const manager of [true, false]) {
      mode.manager = manager;
      const onChange = vi.fn();
      await mount(() => useSiteAgent('https://example.com/', false, settings(), onChange));
      expect(onChange).toHaveBeenCalledTimes(manager ? 0 : 1);
    }
  });
});

describe('a manager chat keeps its agent and model', async () => {
  const { splitChange, ManagerScope, OwnModelContext } = await import('../src/entrypoints/sidepanel/manager-chat');
  const { SettingsContext, useSettingsContext } = await import('../src/ui/settings-context');
  const { useContext } = await import('react');
  const base = { providers: [{ id: 'p', name: 'P', baseURL: 'https://api.example.com/v1', apiKey: '' }], activeAgentId: 'global' } as unknown as Settings;

  it('choosing an agent changes only the chat', () => {
    expect(splitChange(base, { agentId: 'a1' }, { activeAgentId: 'b2' })).toEqual({ choice: { agentId: 'b2' }, global: undefined });
  });
  it('another agent drops the model chosen for the one before', () => {
    expect(splitChange(base, { agentId: 'a1', model: { providerId: 'p', model: 'm1' } }, { activeAgentId: 'b2' }).choice).toEqual({ agentId: 'b2' });
  });
  it('the same agent keeps it', () => {
    expect(splitChange(base, { agentId: 'a1', model: { providerId: 'p', model: 'm1' } }, { includePage: false }).choice).toEqual({ agentId: 'a1', model: { providerId: 'p', model: 'm1' } });
  });
  it('other fields still go to the settings', () => {
    expect(splitChange(base, { agentId: 'a1' }, { includePage: false, activeAgentId: 'b2' }).global).toEqual({ ...base, includePage: false });
  });
  it('a change made as a function that changes nothing goes nowhere', () => {
    expect(splitChange(base, { agentId: 'a1' }, (s) => s).global).toBeUndefined();
  });
  it('a change made as a function never saves the chat agent', () => {
    const r = splitChange(base, { agentId: 'a1' }, (s) => ({ ...s, chatRender: 'plain' }) as Settings);
    expect(r.global).toEqual({ ...base, chatRender: 'plain' });
    expect(r.choice.agentId).toBe('a1');
  });

  it('in the chat: its URL agent first, then the picker and the model picker write no settings', async () => {
    const save = vi.fn(async (_change: unknown) => undefined);
    const seen: { agentId?: string; model?: unknown; pick?: (p: string, m: string) => void; update?: (c: Partial<Settings>) => void } = {};
    const Probe = () => {
      const { settings, update } = useSettingsContext();
      const own = useContext(OwnModelContext);
      Object.assign(seen, { agentId: settings.activeAgentId, model: own?.model, pick: own?.pick, update });
      return null;
    };
    const root = createRoot(document.createElement('div'));
    const tree = () => createElement(SettingsContext.Provider, { value: { settings: base, update: (c) => void save(c), save } }, createElement(ManagerScope, null, createElement(Probe)));
    await act(async () => root.render(tree()));
    expect(seen.agentId).toBe('a1');
    await act(async () => seen.update!({ activeAgentId: 'builder' }));
    await act(async () => seen.pick!('p', 'm2'));
    // What reaches the settings is applied on the latest ones (useSettings): unchanged, nothing is saved.
    const applied = () => save.mock.calls.map(([change]) => (typeof change === 'function' ? (change as (s: Settings) => Settings)(base) : { ...base, ...(change as Partial<Settings>) }));
    expect(applied().every((s) => s === base)).toBe(true);
    expect(seen.agentId).toBe('builder');
    expect(seen.model).toEqual({ providerId: 'p', model: 'm2' });
    await act(async () => seen.update!({ includePage: false }));
    expect(applied().at(-1)).toEqual({ ...base, includePage: false });
    act(() => root.unmount());
  });
});

describe('the status a manager chat posts', async () => {
  const { turnProgress, managerStatus, useManagerStatus } = await import('../src/entrypoints/sidepanel/manager-chat');
  const { chatUrl, MANAGER_STATUS, MANAGER_STOP, MANAGER_STOPPED } = await import('../src/manager/protocol');
  type Message = import('../src/core/types').Message;
  const user = (t: string) => ({ role: 'user', parts: [{ type: 'text', text: t }] }) as Message;
  const calls = (name: string) => ({ role: 'assistant', parts: [{ type: 'tool_call', id: name, name, args: {} }] }) as Message;

  it('working: the step in flight and the last tool of this turn', () => {
    expect(turnProgress([user('old'), calls('browser.find'), user('buy it'), calls('browser.find'), calls('browser.click')], true)).toEqual({ step: 3, lastTool: 'browser.click' });
    expect(turnProgress([user('buy it'), calls('browser.find')], false)).toEqual({ step: 1, lastTool: 'browser.find' });
  });
  it('waiting wins over working', () => {
    const s = managerStatus({ conversationId: 'c', history: [user('Compare prices')], busy: true, waiting: true, given: 0 }, { tabId: 7, url: 'https://shop.example.com/a', title: 'Shop' }, { id: 'b', name: '🛠️ Builder' }, 'm', 1000);
    expect(s).not.toHaveProperty('answer'); // none while it works
    expect(s).toMatchObject({ state: 'waiting', said: true, conversationId: 'c', title: 'Compare prices', tabId: 7, url: 'https://shop.example.com/a', pageTitle: 'Shop', step: 1, maxSteps: 15, agentId: 'b', agentName: '🛠️ Builder', model: 'm', turnStartedAt: 1000 });
  });
  it('idle, with nothing said yet', () => {
    expect(managerStatus({ conversationId: 'c', history: [], busy: false, waiting: false, given: 0 }, {}, { name: 'Browser' }, 'm', undefined)).toMatchObject({ state: 'idle', said: false, step: 0 });
  });
  it('idle: its last answer, and how many messages the page gave it went', () => {
    const answered = [user('Compare prices'), { role: 'assistant', parts: [{ type: 'text', text: 'The second is cheaper.' }] } as Message];
    expect(managerStatus({ conversationId: 'c', history: answered, busy: false, waiting: false, given: 2 }, {}, { name: 'Browser' }, 'm', undefined)).toMatchObject({ answer: 'The second is cheaper.', given: 2 });
  });
  it('the URL of a chat', () => {
    expect(chatUrl(7)).toBe('sidepanel.html?tab=7&manager');
    expect(chatUrl(7, 'a b')).toBe('sidepanel.html?tab=7&manager&agent=a%20b');
  });

  it('posts to its parent only, and stops on its word', async () => {
    const posted = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
    const stop = vi.fn();
    const busy = { ...agent(), busy: true, confirmations: [], stop } as unknown as Agent;
    const base = { providers: [{ id: 'p', name: 'P', baseURL: 'https://api.example.com/v1', apiKey: '', defaultModel: 'm' }] } as unknown as Settings;
    const { SettingsContext } = await import('../src/ui/settings-context');
    const Probe = ({ chat }: { chat: Agent }) => (useManagerStatus(chat, page), null);
    const root = createRoot(document.createElement('div'));
    const render = (chat: Agent) => act(async () => root.render(createElement(SettingsContext.Provider, { value: { settings: base, update: vi.fn(), save: vi.fn() } }, createElement(Probe, { chat }))));
    await render(busy);
    expect(posted).toHaveBeenCalledWith({ type: MANAGER_STATUS, status: expect.objectContaining({ state: 'working', agentName: '🌐 Browser', model: 'm' }) }, location.origin);
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: { type: MANAGER_STOP }, origin: 'https://example.com', source: window.parent })));
    expect(stop).not.toHaveBeenCalled();
    act(() => void window.dispatchEvent(new MessageEvent('message', { data: { type: MANAGER_STOP }, origin: location.origin, source: window.parent })));
    expect(stop).toHaveBeenCalledTimes(1);
    // Stopped once its turn is saved (useHistory, after the turn ends): removed before, it would not be.
    await render({ ...busy, busy: false } as Agent);
    expect(posted).not.toHaveBeenCalledWith({ type: MANAGER_STOPPED }, location.origin);
    await act(async () => storage.local.set({ convIndex: [] }));
    expect(posted).toHaveBeenLastCalledWith({ type: MANAGER_STOPPED }, location.origin);
    act(() => root.unmount());
    posted.mockRestore();
  });
});
