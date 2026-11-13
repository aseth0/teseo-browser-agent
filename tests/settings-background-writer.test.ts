// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeEvent, fakeSecretDb, fakeStorage } from './fakes/browser';
import type { useSettings as UseSettings } from '../src/ui/useSettings';

// The pages hand each change to the background as they make it (core/protocol SETTINGS_EDIT), which
// stores it on the settings as stored: a page closed right after the change still has it stored.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const storage = fakeStorage();
const secrets = fakeSecretDb();
type Listener = (msg: unknown, sender: { url?: string }, reply: (r: unknown) => void) => unknown;
const onMessage = fakeEvent<Listener>();
// The messages the pages sent, held until the test delivers them (in the order it wants) when `hold`.
const wire = vi.hoisted(() => ({ hold: false, held: [] as (() => void)[], unreachable: false }));
const PAGE = { url: 'chrome-extension://x/options.html' };
const sendMessage = vi.fn((msg: unknown) => {
  if (wire.unreachable) return Promise.reject(new Error('Could not establish connection. Receiving end does not exist.'));
  const copy = JSON.parse(JSON.stringify(msg)) as unknown; // what crosses: JSON
  return new Promise((resolve) => {
    const deliver = () => {
      let answered = false;
      const kept = onMessage.emit(copy, PAGE, (r) => ((answered = true), resolve(r)));
      if (!answered && !kept.includes(true)) resolve(undefined);
    };
    if (wire.hold) wire.held.push(deliver);
    else deliver();
  });
});
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage, { runtime: { getURL: (p: string) => `chrome-extension://x${p}`, id: 'x', onMessage, sendMessage } }) }));
vi.mock('../src/context/model-settings', () => ({ applyModelSettings: () => undefined, modelSettingsKey: () => '' }));

const { loadSettings, saveSettings } = await import('../src/storage/settings');
const { SETTINGS_KEY } = await import('../src/storage/settings-types');
const { listenSettingsEdits } = await import('../src/background/settings');
const { useSettings } = await import('../src/ui/useSettings');
listenSettingsEdits();

const provider = { id: 'p', name: 'P', baseURL: 'https://llm.test/v1', apiKey: '', defaultModel: 'm' };

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
const deliver = async (order: number[]) => {
  const held = wire.held;
  wire.held = [];
  wire.hold = false;
  await act(async () => {
    for (const i of order) held[i]!();
  });
};

afterEach(() => {
  storage.reset();
  secrets.data.clear();
  secrets.trusted = true;
  Object.assign(wire, { hold: false, held: [], unreachable: false });
  sendMessage.mockClear();
});

describe('a page closed right after a change', () => {
  it('hands the change over before the save awaits anything, and the background stores it', async () => {
    await saveSettings({ ...(await loadSettings()), providers: [provider] });
    const options = await open();
    wire.hold = true;
    act(() => {
      options.now()[1]((s) => ({ ...s, chatView: { ...s.chatView, hiddenTools: ['browser.find'] } }));
      // Sent in the same tick as the change, nothing awaited: the page may be gone right after.
      expect(sendMessage).toHaveBeenCalledTimes(1);
    });
    options.unmount();
    await deliver([0]);
    await vi.waitFor(async () => expect((await loadSettings()).chatView?.hiddenTools).toEqual(['browser.find']));
  });
});

describe('two pages saving through the background', () => {
  it('keeps both changes when the later one is stored first', async () => {
    await saveSettings({ ...(await loadSettings()), providers: [provider] });
    const options = await open();
    const panel = await open();
    wire.hold = true;
    let saves: Promise<void>[] = [];
    act(() => {
      saves = [
        options.now()[3]((s) => ({ ...s, providers: s.providers.map((p) => ({ ...p, apiKey: 'sk-new' })) })),
        panel.now()[3]((s) => ({ ...s, chatView: { ...s.chatView, textSize: 120 } })),
      ];
    });
    await deliver([1, 0]);
    await act(async () => void (await Promise.all(saves)));
    const stored = await loadSettings();
    expect(stored.providers[0]!.apiKey).toBe('sk-new');
    expect(stored.chatView?.textSize).toBe(120);
    await vi.waitFor(() => {
      for (const page of [options, panel]) expect(page.now()[0]).toMatchObject({ chatView: { textSize: 120 }, providers: [{ apiKey: 'sk-new' }] });
    });
    options.unmount();
    panel.unmount();
  });

  it('keeps two fields of one object changed by two pages at once', async () => {
    const options = await open();
    const panel = await open();
    wire.hold = true;
    act(() => {
      options.now()[1]((s) => ({ ...s, chatView: { ...s.chatView, turnDiagram: 'pie' } }));
      panel.now()[1]((s) => ({ ...s, chatView: { ...s.chatView, textSize: 90 } }));
    });
    await deliver([1, 0]);
    await vi.waitFor(async () => expect((await loadSettings()).chatView).toMatchObject({ turnDiagram: 'pie', textSize: 90 }));
    options.unmount();
    panel.unmount();
  });

  it('applies a page\'s change over the whole settings an older build wrote meanwhile', async () => {
    const options = await open();
    // An older build: the whole settings at once, no stamp.
    await act(async () => storage.local.set({ [SETTINGS_KEY]: { ...(await loadSettings()), providers: [provider], systemPrompt: 'older' } }));
    await act(async () => options.now()[3]({ includePage: false }));
    expect(await loadSettings()).toMatchObject({ systemPrompt: 'older', includePage: false, providers: [{ id: 'p' }] });
    options.unmount();
  });
});

describe('a save the background could not store', () => {
  it('shows the error and takes the change back', async () => {
    const options = await open();
    const before = options.now()[0]!.includePage;
    secrets.trusted = false; // the stored settings cannot be read
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => expect(options.now()[3]({ includePage: !before })).rejects.toThrow());
    expect(options.now()[2]).toMatch(/^Could not save the settings: /);
    expect(options.now()[0]!.includePage).toBe(before);
    error.mockRestore();
    options.unmount();
  });

  it('is stored by the page itself when no worker answers', async () => {
    const options = await open();
    wire.unreachable = true;
    await act(async () => options.now()[3]({ systemPrompt: 'here' }));
    expect((await loadSettings()).systemPrompt).toBe('here');
    options.unmount();
  });

  it('is not taken from a page\'s content script', async () => {
    let answer: unknown = 'none';
    const kept = onMessage.emit({ type: 'browser-agent:settings-edit', edit: [{ path: ['systemPrompt'], value: 'site' }], stamp: 's' }, { url: 'https://site.test/' }, (r) => (answer = r));
    expect(kept).toEqual([undefined]);
    expect(answer).toBe('none');
    expect((await loadSettings()).systemPrompt).not.toBe('site');
  });
});
