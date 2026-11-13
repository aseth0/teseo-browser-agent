// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import type { useSettings as UseSettings } from '../src/ui/useSettings';

// Two pages (Options and a side panel) saving the settings one right after the other, each before
// the other's echo reaches it: neither undoes what the other saved.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = fakeStorage();
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
vi.mock('../src/context/model-settings', () => ({ applyModelSettings: () => undefined }));

const { loadSettings, saveSettings } = await import('../src/storage/settings');
const { useSettings } = await import('../src/ui/useSettings');

const provider = { id: 'p', name: 'P', baseURL: 'https://llm.test/v1', apiKey: '', defaultModel: 'm' };
const server = { id: 's', name: 'S', url: 'https://mcp.test/mcp', enabled: true };

type Page = { now: () => ReturnType<typeof UseSettings>; unmount: () => void };
async function open(): Promise<Page> {
  let seen: ReturnType<typeof UseSettings>;
  function Probe() {
    seen = useSettings();
    return null;
  }
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  return { now: () => seen, unmount: () => act(() => root.unmount()) };
}

afterEach(() => {
  storage.reset();
  secrets.data.clear();
});

describe('two pages saving the settings', () => {
  it('keeps the key one saved when the other saves a field from an older copy', async () => {
    await saveSettings({ ...(await loadSettings()), providers: [provider] });
    const options = await open();
    const panel = await open();
    await act(async () => {
      const typed = options.now()[3]((s) => ({ ...s, providers: s.providers.map((p) => ({ ...p, apiKey: 'sk-new' })) }));
      const toggled = panel.now()[3]({ includePage: false });
      await Promise.all([typed, toggled]);
    });
    const stored = await loadSettings();
    expect(stored.providers[0]!.apiKey).toBe('sk-new');
    expect(stored.includePage).toBe(false);
    options.unmount();
    panel.unmount();
  });

  it('keeps the MCP server one added when the other changes the list it saw before', async () => {
    await saveSettings({ ...(await loadSettings()), providers: [provider], mcpServers: [] });
    const options = await open();
    const panel = await open();
    await act(async () => {
      const added = options.now()[3]((s) => ({ ...s, mcpServers: [...(s.mcpServers ?? []), server] }));
      // What the panel does as it sees a new tool group (useAgentTools): a function of the settings.
      const seen = panel.now()[3]((s) => ({ ...s, chatView: { ...s.chatView, seenToolGroups: ['g'] } }));
      await Promise.all([added, seen]);
    });
    const stored = await loadSettings();
    expect(stored.mcpServers?.map((m) => m.id)).toEqual(['s']);
    expect(stored.chatView?.seenToolGroups).toEqual(['g']);
    options.unmount();
    panel.unmount();
  });

  it('stores the URLs and the secrets of the same save', async () => {
    await saveSettings({ ...(await loadSettings()), providers: [provider] });
    const options = await open();
    const panel = await open();
    await act(async () => {
      const a = options.now()[3]((s) => ({ ...s, providers: [{ ...provider, baseURL: 'https://a.test/v1', apiKey: 'sk-a' }] }));
      const b = panel.now()[3]((s) => ({ ...s, providers: [{ ...provider, baseURL: 'https://b.test/v1', apiKey: 'sk-b' }] }));
      await Promise.all([a, b]);
    });
    const stored = await loadSettings();
    expect(stored.providers[0]).toMatchObject({ baseURL: 'https://b.test/v1', apiKey: 'sk-b' });
    options.unmount();
    panel.unmount();
  });

  it('shows each page what the other saved', async () => {
    await saveSettings({ ...(await loadSettings()), providers: [provider] });
    const options = await open();
    const panel = await open();
    await act(async () => {
      await Promise.all([options.now()[3]({ systemPrompt: 'from options' }), panel.now()[3]({ includePage: false })]);
    });
    await vi.waitFor(() => {
      for (const page of [options, panel]) expect(page.now()[0]).toMatchObject({ systemPrompt: 'from options', includePage: false });
    });
    options.unmount();
    panel.unmount();
  });
});
