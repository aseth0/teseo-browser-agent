// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';
import type { useSettings as UseSettings } from '../src/ui/useSettings';

// Changes apply on top of the latest settings, also two in the same tick; a failed save is shown.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const stored = { providers: [], includePage: true } as unknown as Settings;
// What the settings were stored as: each change applied to them as they were by then.
let now = stored;
let turn: Promise<unknown> = Promise.resolve();
const saveSettings = vi.fn(async (_s: Settings) => undefined);
const applied = vi.fn((_s: Settings) => undefined);
let changed: (s: Settings, stamp?: string) => void = () => undefined;
const stamps: string[] = []; // of the saves, in turn, as each is handed over inside the change
// No worker answers: the page stores the change itself (updateSettings below).
vi.mock('../src/core/runtime', () => ({
  sendRuntime: (msg: { stamp: string }) => {
    stamps.push(msg.stamp);
    return Promise.reject(new Error('Could not establish connection.'));
  },
}));
vi.mock('../src/storage/settings', () => ({
  loadSettings: async () => stored,
  onSettingsChanged: (cb: (s: Settings, stamp?: string) => void) => {
    changed = cb;
    return () => undefined;
  },
  // One at a time, each on what the one before stored.
  updateSettings: (change: (s: Settings) => Settings) => {
    const write = async () => {
      const s = change(now);
      await saveSettings(s);
      now = s;
      return s;
    };
    const done = turn.then(write, write);
    turn = done.catch(() => undefined);
    return done;
  },
}));
vi.mock('../src/context/model-settings', () => ({ applyModelSettings: (s: Settings) => applied(s) }));
const { useSettings } = await import('../src/ui/useSettings');

let seen: ReturnType<typeof UseSettings>;
function Probe() {
  seen = useSettings();
  return null;
}

async function mount() {
  const root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
  return root;
}

describe('useSettings', () => {
  it('applies two changes made in the same tick, each on the other', async () => {
    const root = await mount();
    act(() => {
      const update = seen[1];
      update({ includePage: false });
      update((s) => ({ ...s, chatRender: 'plain' }));
    });
    expect(seen[0]).toMatchObject({ includePage: false, chatRender: 'plain' });
    await act(async () => undefined);
    expect(saveSettings).toHaveBeenLastCalledWith(expect.objectContaining({ includePage: false, chatRender: 'plain' }));
    act(() => root.unmount());
  });

  it('shows a save that failed', async () => {
    const root = await mount();
    saveSettings.mockRejectedValueOnce(new Error('quota'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => seen[1]({ includePage: false }));
    expect(seen[2]).toBe('Could not save the settings: quota');
    error.mockRestore();
    act(() => root.unmount());
  });

  it('settles `save` once the change is stored, and rejects it when it is not', async () => {
    const root = await mount();
    await act(async () => expect(seen[3]({ includePage: false })).resolves.toBeUndefined());
    saveSettings.mockRejectedValueOnce(new Error('quota'));
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await act(async () => expect(seen[3]({ includePage: true })).rejects.toThrow('quota'));
    error.mockRestore();
    act(() => root.unmount());
  });

  it('applies the texts and limits of each change before it renders', async () => {
    const root = await mount();
    act(() => seen[1]({ includePage: false }));
    expect(applied).toHaveBeenLastCalledWith(seen[0]);
    act(() => root.unmount());
  });

  it('keeps its saves not echoed yet on top of an earlier echo, and takes another page\'s change', async () => {
    const root = await mount();
    const first = stamps.length;
    act(() => {
      seen[1]({ systemPrompt: 'a' });
      seen[1]({ systemPrompt: 'ab' });
    });
    act(() => changed({ ...stored, systemPrompt: 'a' }, stamps[first]));
    expect(seen[0]?.systemPrompt).toBe('ab');
    act(() => changed({ ...stored, systemPrompt: 'ab' }, stamps[first + 1]));
    expect(seen[0]?.systemPrompt).toBe('ab');
    act(() => changed({ ...stored, systemPrompt: 'other page' }));
    expect(seen[0]?.systemPrompt).toBe('other page');
    act(() => root.unmount());
  });

  it('never takes another page\'s change for the echo of an own save', async () => {
    const root = await mount();
    const keyed = (apiKey: string) => ({ ...stored, providers: [{ id: 'p', name: 'P', baseURL: 'https://llm.test/v1', apiKey, defaultModel: 'm' }] }) as Settings;
    act(() => changed(keyed('')));
    // A save of a secret alone: what storage.local holds of the settings stays the same.
    await act(async () => seen[3]((s) => ({ ...s, providers: s.providers.map((p) => ({ ...p, apiKey: 'mine' })) })));
    act(() => {
      seen[1]({ systemPrompt: 'typing' });
      // Another page saves its own key meanwhile.
      changed(keyed('theirs'));
    });
    expect(seen[0]?.providers[0]?.apiKey).toBe('theirs');
    expect(seen[0]?.systemPrompt).toBe('typing');
    act(() => root.unmount());
  });
});
