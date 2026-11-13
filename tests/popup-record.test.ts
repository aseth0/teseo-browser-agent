// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RecordingStatus } from '../src/recording/recorder-protocol';
import type { Settings } from '../src/storage/settings-types';

// The toolbar popup's Record line: starts a recording of the tab with a preset, says it records and
// stops it, and offers the one waiting for review.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sendMessage = vi.fn(async (_m: unknown): Promise<unknown> => ({ started: true }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage }, debugger: {} } }));
let status: RecordingStatus | undefined;
vi.mock('../src/ui/useRecordingStatus', () => ({ useRecordingStatus: () => status }));
const { RecordLine } = await import('../src/entrypoints/popup/RecordLine');
const P = await import('../src/recording/protocol');

const tab = (url = 'https://shop.example.com/a') => ({ id: 4, windowId: 2, url }) as never;
const onDone = vi.fn((p: Promise<unknown>) => void p);
const onError = vi.fn();
async function show(settings: Partial<Settings> = {}, url?: string) {
  const box = document.createElement('div');
  await act(async () => createRoot(box).render(createElement(RecordLine, { tab: tab(url), settings: settings as Settings, shortcuts: [{ name: 'record-toggle', description: '', shortcut: 'Alt+Shift+R' }], onDone, onError })));
  const button = (name: string) => box.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;
  return { box, button, text: () => box.textContent ?? '' };
}
const base: RecordingStatus = { state: 'recording', tabId: 4, windowId: 2, tabs: [4], site: 'shop.example.com', calls: 1, leftOut: 0, startedAt: Date.now(), preset: 'API calls', mode: 'tab' };

beforeEach(() => {
  status = undefined;
  vi.clearAllMocks();
});

describe('the Record line, nothing recording', () => {
  it('a preset to choose and this tab; the other modes only on DevTools', async () => {
    const { box, button, text } = await show();
    expect(text()).toContain('Requests');
    expect([...box.querySelectorAll('option')].map((o) => o.textContent)).toEqual(['API calls', 'Everything', 'Errors only']);
    expect(box.querySelector('select')!.value).toBe('api');
    expect(button('This tab (Alt+Shift+R)').disabled).toBe(false);
    expect(button('Several tabs')).toBeNull();
    const on = await show({ devtoolsTools: true });
    expect(on.button('Several tabs').disabled).toBe(false);
    expect(on.button('Tabs and mouse').disabled).toBe(false);
  });
  it('starts with the preset chosen, and the popup closes', async () => {
    const { box, button } = await show({ recordingPreset: 'everything' });
    const select = box.querySelector('select')!;
    expect(select.value).toBe('everything');
    await act(async () => {
      select.value = 'errors';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () => button('This tab (Alt+Shift+R)').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: P.RECORDING_START, tabId: 4, windowId: 2, mode: 'tab', presetId: 'errors' });
    expect(onDone).toHaveBeenCalled();
  });
  it('one waiting for review: opens it instead', async () => {
    sendMessage.mockResolvedValueOnce({ waiting: true });
    const { button } = await show();
    await act(async () => button('This tab (Alt+Shift+R)').click());
    expect(sendMessage).toHaveBeenLastCalledWith({ type: P.RECORDING_REVIEW, tabId: 4, windowId: 2 });
  });
  it('could not start: says why, the popup stays', async () => {
    sendMessage.mockResolvedValueOnce({ error: 'This site is not enabled.' });
    const { button } = await show();
    await act(async () => button('This tab (Alt+Shift+R)').click());
    await act(async () => undefined);
    expect(onError).toHaveBeenCalledWith('This site is not enabled.');
  });
  it('off on a page it cannot record', async () => {
    const { button } = await show({}, 'chrome://extensions/');
    expect(button('This tab (Alt+Shift+R)').disabled).toBe(true);
    expect(button('This tab (Alt+Shift+R)').title).toBe('Pages like this one cannot be recorded');
  });
});

describe('the Record line, recording', () => {
  it('counts and stops', async () => {
    status = base;
    const { button, text } = await show();
    expect(text()).toContain('Recording requests1 call · 0:00');
    await act(async () => button('Stop recording').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: P.RECORDING_STOP });
    expect(onDone).toHaveBeenCalled();
  });
  it('one waiting: its count, Discard and Review', async () => {
    status = { ...base, state: 'stopped', calls: 3, leftOut: 2 };
    const { button, text } = await show();
    expect(text()).toContain('Requests recorded3 calls · 2 left out');
    await act(async () => button('Discard the recording').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: P.RECORDING_DISCARD });
    await act(async () => button('Review the recording').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: P.RECORDING_REVIEW, tabId: 4, windowId: 2 });
  });
});
