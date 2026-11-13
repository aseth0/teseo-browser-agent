// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AudioStatus } from '../src/audio/protocol';
import type { Transcript } from '../src/audio/transcript';

// The review of a tab's audio: its transcript a line per stretch, editable, a click on a time plays
// from there; a failed chunk with Retry; Send to chat for the captured tab; Discard confirmed here.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const A = await import('../src/audio/protocol');
let transcript: Transcript;
const listeners: ((m: unknown, s: unknown, r: (x: unknown) => void) => void)[] = [];
const sendMessage = vi.fn(async (m: { type: string }): Promise<unknown> => {
  if (m.type === A.AUDIO_TRANSCRIPT) return { transcript };
  if (m.type === A.AUDIO_FILE) return { url: 'blob:chrome-extension://id/1', name: 'audio-video.example.test-2026-11-02-0900.webm' };
  return {};
});
const tabsUpdate = vi.fn(async () => ({}));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { sendMessage, onMessage: { addListener: (l: never) => listeners.push(l), removeListener: () => undefined } },
    tabs: { get: async (id: number) => ({ id, windowId: 2 }), getCurrent: async () => ({ id: 9, windowId: 2 }), update: tabsUpdate },
  },
}));
let status: AudioStatus | undefined;
vi.mock('../src/ui/useAudioStatus', () => ({ useAudioStatus: () => status }));
vi.mock('../src/ui/useSettings', () => ({ useSettings: () => [{ panelFollows: false }] }));
vi.mock('../src/ui/appearance', () => ({ useAppearance: () => undefined }));
const { AudioReview } = await import('../src/entrypoints/audio/AudioReview');

const stopped: AudioStatus = { state: 'stopped', tabId: 4, windowId: 2, site: 'video.example.test', startedAt: 0, endedAt: 75_000, to: 'review', progress: { sending: 0, failed: 1, done: true } };
async function show() {
  const box = document.createElement('div');
  document.body.append(box);
  await act(async () => createRoot(box).render(createElement(AudioReview)));
  await act(async () => undefined);
  const button = (name: string) => [...box.querySelectorAll('button')].find((b) => b.textContent === name || b.title === name)!;
  return { box, button, lines: () => [...box.querySelectorAll('textarea')].map((t) => t.value) };
}

beforeEach(() => {
  vi.clearAllMocks();
  status = stopped;
  transcript = {
    parts: [
      { n: 0, state: 'done', lines: [{ at: 0, text: 'Hello and welcome.' }, { at: 12.5, text: 'Today: tides.' }] },
      { n: 1, state: 'failed', error: 'audio/transcriptions 500: busy' },
    ],
    edits: {},
    done: true,
    chunkSeconds: 30,
  };
  HTMLMediaElement.prototype.play = vi.fn(async () => undefined);
  Element.prototype.scrollIntoView = vi.fn();
});

describe('the audio review', () => {
  it('a line per stretch, with its time, and the chunk that failed', async () => {
    const { box, lines } = await show();
    expect(box.querySelector('h1')?.textContent).toBe('Audio of video.example.test (1:15)');
    expect(lines()).toEqual(['Hello and welcome.', 'Today: tides.']);
    expect([...box.querySelectorAll('.audio-time')].map((t) => t.textContent)).toEqual(['0:00', '0:12', '0:30–1:00']);
    expect(box.textContent).toContain('Not transcribed (audio/transcriptions 500: busy).');
    expect(box.textContent).toContain('1 chunk not transcribed: Retry below.');
  });

  it('Retry sends that chunk again', async () => {
    const { button } = await show();
    await act(async () => button('Retry').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: A.AUDIO_RETRY, n: 1 });
  });

  it('an edit is kept by the offscreen document', async () => {
    const { box, lines } = await show();
    const area = box.querySelector('textarea')!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!.call(area, 'Hello, and welcome.');
      area.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(sendMessage).toHaveBeenCalledWith({ type: A.AUDIO_EDIT, key: '0:0', text: 'Hello, and welcome.' });
    expect(lines()[0]).toBe('Hello, and welcome.');
  });

  it('a time plays from there, and the line playing is marked', async () => {
    const { box, button } = await show();
    await act(async () => button('0:12').click());
    const audio = box.querySelector('audio')!;
    expect(audio.currentTime).toBe(12.5);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    await act(async () => audio.dispatchEvent(new Event('timeupdate')));
    expect(box.querySelector('.audio-line.playing textarea')?.getAttribute('aria-label')).toBe('Line at 0:12');
  });

  it('Send to chat: the captured tab\'s chat, which comes forward with a panel per tab', async () => {
    const { button } = await show();
    await act(async () => button('Send to chat').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: A.AUDIO_TO_CHAT, tabId: 4, windowId: 2 });
    expect(tabsUpdate).toHaveBeenCalledWith(4, { active: true });
  });

  it('waits for the chunks still out', async () => {
    status = { ...stopped, progress: { sending: 1, failed: 0, done: true } };
    const { box, button } = await show();
    expect(button('Send to chat').disabled).toBe(true);
    expect(box.textContent).toContain('Transcribing 1 chunk…');
  });

  it('Discard asks here first', async () => {
    const close = vi.spyOn(window, 'close').mockImplementation(() => undefined);
    const { box, button } = await show();
    await act(async () => button('Discard').click());
    expect(sendMessage).not.toHaveBeenCalledWith({ type: A.AUDIO_DISCARD });
    expect(box.textContent).toContain('Discard the audio and its transcript?');
    await act(async () => button('Discard').click());
    expect(sendMessage).toHaveBeenCalledWith({ type: A.AUDIO_DISCARD });
    expect(close).toHaveBeenCalled();
  });

  it('nothing kept: says so', async () => {
    status = undefined;
    const { box } = await show();
    expect(box.textContent).toContain('No audio is kept');
  });
});
