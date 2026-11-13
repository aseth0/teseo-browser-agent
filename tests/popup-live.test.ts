// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage } from './fakes/browser';
import { buttonNamed, pageBrowser, pageGlobals, settle } from './fakes/panel';
import type { RecordingStatus } from '../src/recording/recorder-protocol';

// The toolbar popup over the stored settings and the background's status, as they change while it is
// open: what Settings → Appearance → Popup hides, a recording that runs (its count and its time going
// on, Stop), and one stopped that waits for its review (Discard).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage);
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { loadSettings, saveSettings } = await import('../src/storage/settings');
const { RECORDING_STATUS } = await import('../src/recording/recorder-protocol');
const { RECORDING_DISCARD, RECORDING_STOP } = await import('../src/recording/protocol');
const { Popup } = await import('../src/entrypoints/popup/Popup');

let root: Root;
let box: HTMLElement;
async function open() {
  box = document.body.appendChild(document.createElement('div'));
  root = createRoot(box);
  await act(async () => root.render(createElement(Popup)));
  await settle(20);
}
const item = (name: string) => box.querySelector<HTMLButtonElement>(`[role="menuitem"][aria-label="${name}"]`);
const line = (label: string) => box.querySelector(`[role="group"][aria-label="${label}"]`);
const recording = (change: Partial<RecordingStatus> = {}): RecordingStatus => ({ state: 'recording', tabId: 1, windowId: 1, tabs: [1], site: 'shop.example.com', calls: 2, leftOut: 0, startedAt: Date.now(), preset: 'API calls', mode: 'tab', ...change });
const background = (status: RecordingStatus | undefined) => act(async () => (status ? storage.session.set({ [RECORDING_STATUS]: status }) : storage.session.remove(RECORDING_STATUS)));

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
  fake.sendMessage.mockClear();
  vi.spyOn(window, 'close').mockImplementation(() => undefined);
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('the popup, as things change while it is open', () => {
  it('a line hidden in Settings is left out, and goes when hidden from Settings meanwhile', async () => {
    await saveSettings({ ...(await loadSettings()), popup: { hidden: ['agents'] } });
    await open();
    expect(item('Chat full screen in a tab')).not.toBeNull();
    expect([...box.querySelectorAll('[role="menuitem"]')].some((b) => b.textContent === 'Agents Panel')).toBe(false);
    await act(async () => saveSettings({ ...(await loadSettings()), popup: { hidden: ['agents', 'full-screen'] } }));
    await settle();
    expect(item('Chat full screen in a tab')).toBeNull();
  });

  it('a recording started elsewhere shows with its count, which follows the background', async () => {
    await open();
    expect(line('Record')!.textContent).not.toContain('Recording requests');
    await background(recording({ calls: 2 }));
    expect(line('Record')!.textContent).toContain('Recording requests');
    expect(line('Record')!.textContent).toContain('2 calls');
    await background(recording({ calls: 5 }));
    expect(line('Record')!.textContent).toContain('5 calls');
  });

  it("a recording's time goes on while the popup is open", async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    await background(recording({ startedAt: Date.now() }));
    await open();
    expect(line('Record')!.textContent).toContain('0:00');
    await act(async () => void vi.advanceTimersByTime(65_000));
    expect(line('Record')!.textContent).toContain('1:05');
  });

  it('Stop asks the background to stop it, and the popup closes', async () => {
    await background(recording());
    await open();
    await act(async () => item('Stop recording')!.click());
    await settle();
    expect(fake.sendMessage).toHaveBeenCalledWith({ type: RECORDING_STOP });
    expect(window.close).toHaveBeenCalled();
  });

  it('one stopped waits for its review: Discard asks the background, the line goes back to start once it is gone', async () => {
    await background(recording({ state: 'stopped', calls: 7, leftOut: 2, endedAt: Date.now() }));
    await open();
    expect(line('Record')!.textContent).toContain('7 calls · 2 left out');
    await act(async () => buttonNamed(line('Record')!, 'Discard the recording')!.click());
    expect(fake.sendMessage).toHaveBeenCalledWith({ type: RECORDING_DISCARD });
    await background(undefined);
    expect(item('Discard the recording')).toBeNull();
    expect(line('Record')!.querySelector('.popup-start')).not.toBeNull();
  });
});
