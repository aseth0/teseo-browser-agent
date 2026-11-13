// @vitest-environment jsdom
import { act, createElement, useContext } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Agent } from '../src/entrypoints/sidepanel/useAgent';
import type { Settings } from '../src/storage/settings';
import { fakeBrowser, fakeStorage } from './fakes/browser';

// The chat full-screen in a tab (sidepanel.html?full): what it leaves to the side panel, and the agent
// and model it keeps to itself.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('../src/ui/floating-frame', () => ({
  FLOATING: false,
  MANAGER: false,
  MANAGER_AGENT: undefined,
  FULL: true,
  PREVIEW: false,
  floatingTab: async () => undefined,
  knownFloatingTab: () => undefined,
}));
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const listConversations = vi.fn(async () => [{ id: 'c1', updatedAt: Date.now(), history: [] }]);
vi.mock('../src/history/store', async (real) => ({
  ...(await real<typeof import('../src/history/store')>()),
  listConversations,
  onConversationsDeleted: () => () => undefined,
}));

const { useHandoff } = await import('../src/entrypoints/sidepanel/useHandoff');
const { HANDOFF_MS } = await import('../src/core/handoff');
const { isConversationPayload } = await import('../src/widget/protocol');
const useWidgetHandoff = (idle: boolean, take: Parameters<typeof useHandoff>[3]) => useHandoff(CHAT_HANDOFF, isConversationPayload, { waitMs: HANDOFF_MS, idle, tag: 'chat-handoff' }, take);
const { useHistory } = await import('../src/entrypoints/sidepanel/useHistory');
const { ManagerScope, OwnModelContext } = await import('../src/entrypoints/sidepanel/manager-chat');
const { SettingsContext, useSettingsContext } = await import('../src/ui/settings-context');
const { CHAT_HANDOFF } = await import('../src/widget/protocol');

const agent = () => ({ conversationId: 'new', history: [], live: { get: () => ({ segments: [] }), subscribe: () => () => undefined }, busy: false, open: vi.fn(), reset: vi.fn(), stop: vi.fn() }) as unknown as Agent;
const base = { providers: [{ id: 'p', name: 'P', baseURL: 'https://api.example.com/v1', apiKey: '' }], history: { enabled: true, resume: 'recent' }, activeAgentId: 'global' } as unknown as Settings;

async function mount(node: () => ReturnType<typeof createElement>) {
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(node()));
  await act(async () => new Promise((r) => setTimeout(r, 10)));
  return root;
}
const probe = (run: () => void) => createElement(() => (run(), null));

describe('the chat in a tab leaves the side panel its own', () => {
  it('does not go on with the latest conversation', async () => {
    const a = agent();
    const root = await mount(() => probe(() => useHistory(a, base, { access: 'ok' } as never, vi.fn(), () => false)));
    expect(listConversations).not.toHaveBeenCalled();
    expect(a.open).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('takes no handoff from the page widget', async () => {
    await storage.session.set({ [CHAT_HANDOFF]: { at: Date.now(), payload: { kind: 'conversation', messages: [] } } });
    const take = vi.fn();
    const root = await mount(() => probe(() => useWidgetHandoff(true, take)));
    expect(take).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it("starts with the settings' agent, then its picker and model picker write no settings", async () => {
    const save = vi.fn(async (_change: unknown) => undefined);
    const seen: { agentId?: string; model?: unknown; pick?: (p: string, m: string) => void; update?: (c: Partial<Settings>) => void } = {};
    const Probe = () => {
      const { settings, update } = useSettingsContext();
      const own = useContext(OwnModelContext);
      Object.assign(seen, { agentId: settings.activeAgentId, model: own?.model, pick: own?.pick, update });
      return null;
    };
    const root = await mount(() => createElement(SettingsContext.Provider, { value: { settings: base, update: (c) => void save(c), save } }, createElement(ManagerScope, null, createElement(Probe))));
    expect(seen.agentId).toBe('global');
    await act(async () => seen.update!({ activeAgentId: 'builder' }));
    await act(async () => seen.pick!('p', 'm2'));
    const applied = save.mock.calls.map(([change]) => (typeof change === 'function' ? (change as (s: Settings) => Settings)(base) : { ...base, ...(change as Partial<Settings>) }));
    expect(applied.every((s) => s === base)).toBe(true);
    expect(seen.agentId).toBe('builder');
    expect(seen.model).toEqual({ providerId: 'p', model: 'm2' });
    act(() => root.unmount());
  });
});
