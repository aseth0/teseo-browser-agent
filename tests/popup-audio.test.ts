// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../src/audio/protocol';
import type { Settings } from '../src/storage/settings-types';

// The toolbar popup's Audio line: captures the tab's audio to where it says (remembered), says it does
// and stops it, then shows how far its transcript is, opens its review, saves or discards what it got.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const sendMessage = vi.fn(async (_m: unknown): Promise<unknown> => ({ started: true }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));
let status: AudioStatus | undefined;
vi.mock('../src/ui/useAudioStatus', () => ({ useAudioStatus: () => status }));
const { AudioLine } = await import('../src/entrypoints/popup/AudioLine');
const A = await import('../src/audio/protocol');

const tab = (url = 'https://video.example.test/watch') => ({ id: 4, windowId: 2, url }) as never;
const onDone = vi.fn((p: Promise<unknown>) => void p);
const onError = vi.fn();
const update = vi.fn();
async function show(url?: string, settings: Partial<Settings> = {}) {
  const box = document.createElement('div');
  const shortcuts = [{ name: A.AUDIO_COMMAND, shortcut: '⌥⇧U', description: '' }];
  await act(async () => createRoot(box).render(createElement(AudioLine, { tab: tab(url), settings: settings as Settings, update, shortcuts, onDone, onError })));
  const button = (name: string) => box.querySelector<HTMLButtonElement>(`button[aria-label^="${name}"]`)!;
  const select = () => box.querySelector<HTMLSelectElement>('select[aria-label="Where the audio goes"]')!;
  // Its name, and the line under it (as "name · line").
  const text = () => [box.querySelector('.popup-row-name')?.textContent ?? '', box.querySelector('.popup-row-sub')?.textContent ?? ''].filter(Boolean).join(' · ');
  return { button, select, text };
}
const base: AudioStatus = { state: 'capturing', tabId: 4, windowId: 2, site: 'video.example.test', startedAt: Date.now() - 74_000 };

beforeEach(() => {
  status = undefined;
  vi.clearAllMocks();
});

describe('the Audio line, nothing captured', () => {
  it('captures this tab for its review by default, and the popup closes', async () => {
    const { button, select, text } = await show();
    expect(text()).toBe("Tab's audio⌥⇧U");
    expect(select().value).toBe('review');
    expect(button("Capture the tab's audio").title).toBe("Capture the tab's audio (⌥⇧U)");
    await act(async () => button("Capture the tab's audio").click());
    expect(sendMessage).toHaveBeenCalledWith({ type: A.AUDIO_START, tabId: 4, windowId: 2, to: 'review' });
    expect(onDone).toHaveBeenCalled();
  });
  it('remembers where it goes', async () => {
    const { button, select } = await show(undefined, { audioTo: 'chat' });
    expect(select().value).toBe('chat');
    await act(async () => button("Capture the tab's audio").click());
    expect(sendMessage).toHaveBeenCalledWith(expect.objectContaining({ to: 'chat' }));
    await act(async () => {
      select().value = 'file';
      select().dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(update).toHaveBeenCalledWith({ audioTo: 'file' });
  });
  it('could not start: says why, the popup stays', async () => {
    sendMessage.mockResolvedValueOnce({ error: 'The browser did not let the extension capture this tab (no).' });
    const { button } = await show();
    await act(async () => button("Capture the tab's audio").click());
    await act(async () => undefined);
    expect(onError).toHaveBeenCalledWith('The browser did not let the extension capture this tab (no).');
    expect(onDone).not.toHaveBeenCalled();
  });
  it('off on a page it cannot capture', async () => {
    const { button } = await show('chrome://extensions/');
    expect(button("Capture the tab's audio").disabled).toBe(true);
  });
});

describe('the Audio line, capturing', () => {
  it('its time, and Stop keeps the popup open', async () => {
    status = base;
    const { button, text } = await show();
    expect(text()).toContain("Capturing the tab's audio · 1:14");
    await act(async () => button("Stop capturing the tab's audio").click());
    expect(sendMessage).toHaveBeenCalledWith({ type: A.AUDIO_STOP });
    expect(onDone).not.toHaveBeenCalled();
  });
});

describe('the Audio line, stopped and transcribed', () => {
  const transcribed = (progress: AudioStatus['progress'], more: Partial<AudioStatus> = {}): AudioStatus => ({ ...base, state: 'stopped', endedAt: base.startedAt + 242_000, to: 'review', progress, ...more });
  it('how far its transcript is', async () => {
    status = transcribed({ sending: 1, failed: 0, done: true });
    expect((await show()).text()).toBe("Tab's audio · 4:02 · transcribing…");
    status = transcribed({ sending: 0, failed: 2, done: true });
    expect((await show()).text()).toBe("Tab's audio · 4:02 · 2 failed");
    status = transcribed({ sending: 0, failed: 0, done: true }, { sent: true });
    expect((await show()).text()).toBe("Tab's audio · 4:02 · in the chat");
    status = transcribed({ sending: 0, failed: 0, done: true });
    expect((await show()).text()).toBe("Tab's audio · 4:02");
  });
  it('Review opens its page, and the popup closes', async () => {
    status = transcribed({ sending: 0, failed: 0, done: true });
    const { button } = await show();
    await act(async () => button('Review the audio').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: A.AUDIO_REVIEW });
    expect(onDone).toHaveBeenCalled();
  });
});

describe('the Audio line, stopped', () => {
  it('its length, its size in Save\'s title; Discard', async () => {
    status = { ...base, state: 'stopped', endedAt: base.startedAt + 242_000, size: 3_800_000 };
    const { button, text } = await show();
    expect(text()).toContain("Tab's audio · 4:02");
    expect(button('Save the audio').title).toBe("Save it as a .webm file (3.8 MB), in the browser's downloads");
    await act(async () => button('Discard the audio').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: A.AUDIO_DISCARD });
  });
  it('Save downloads the file the offscreen document keeps', async () => {
    status = { ...base, state: 'stopped', endedAt: base.startedAt + 1000, size: 2000 };
    sendMessage.mockResolvedValueOnce({ url: 'blob:chrome-extension://id/1', name: 'audio-video.example.test-2026-11-01-1432.webm' });
    const clicked: HTMLAnchorElement[] = [];
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      clicked.push(this);
    });
    const { button } = await show();
    expect(button('Save the audio').title).toContain('(2 KB)');
    await act(async () => button('Save the audio').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: A.AUDIO_FILE });
    expect(clicked[0]?.download).toBe('audio-video.example.test-2026-11-01-1432.webm');
    expect(clicked[0]?.href).toBe('blob:chrome-extension://id/1');
    click.mockRestore();
  });
  it('gone (the extension reloaded): says so', async () => {
    status = { ...base, state: 'stopped', endedAt: base.startedAt + 1000 };
    sendMessage.mockResolvedValueOnce({ error: 'The audio is not kept any more.' });
    const { button } = await show();
    await act(async () => button('Save the audio').click());
    expect(onError).toHaveBeenCalledWith('The audio is not kept any more.');
  });
});
