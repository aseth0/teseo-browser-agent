// @vitest-environment jsdom
import { act, createElement, createRef } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dictation } from '../src/entrypoints/sidepanel/useDictation';

// What dictation tells the message box's strip while it records: since when, the sound level now, the
// chunks out being transcribed, and the words just put in the box. Gone once it ends.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('wxt/browser', () => ({ browser: { runtime: { id: 'ext', getURL: (p: string) => `chrome-extension://ext${p}` } } }));
const provider = { id: 'p', name: 'P', baseURL: 'https://api.example.test/v1', apiKey: 'k', defaultModel: 'm' };
const settings = { providers: [provider], voice: { providerId: 'p', model: 'whisper-1', chunkSeconds: 1 } };
vi.mock('../src/ui/settings-context', () => ({ useSettingsContext: () => ({ settings }) }));
vi.mock('../src/providers/provider-access', () => ({ unreachable: async () => undefined }));
const stopped = vi.fn();
vi.mock('../src/voice/mic', async (original) => ({
  ...(await original<object>()),
  openMic: async () => ({ getTracks: () => [{ stop: stopped }] }),
}));
let level = 0.2;
vi.mock('../src/voice/recorder', () => ({
  chunkRecorder: () => {
    const r = { start: () => undefined, stop: () => r.onchunk(new Blob(['chunk'])), onchunk: (_b: Blob) => undefined };
    return r;
  },
  levelMeter: () => ({ peak: () => 0.5, level: () => level, measured: () => true, close: () => undefined }),
}));
const sent: ((text: string) => void)[] = [];
const failing: ((e: Error) => void)[] = [];
vi.mock('../src/voice/transcribe', async (original) => ({
  ...(await original<object>()),
  transcribe: () => new Promise<string>((resolve, reject) => (sent.push(resolve), failing.push(reject))),
}));
const { useDictation } = await import('../src/entrypoints/sidepanel/useDictation');

let d!: Dictation;
let value = '';
function Host() {
  d = useDictation({ composer: createRef(), setInput: (update) => void (value = update(value)), conversationId: 'c' });
  return null;
}
const settle = async () => {
  for (let i = 0; i < 5; i++) await act(async () => undefined);
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(10_000);
  sent.length = 0;
  failing.length = 0;
  value = '';
  level = 0.2;
  await act(async () => createRoot(document.createElement('div')).render(createElement(Host)));
});
afterEach(() => vi.useRealTimers());

describe('what dictation tells the strip', () => {
  it('since when it records, until it ends', async () => {
    expect(d.startedAt).toBeUndefined();
    await act(async () => d.toggle());
    await settle();
    expect(d.state).toBe('recording');
    expect(d.startedAt).toBe(10_000);
    await act(async () => d.stop());
    expect(d.state).toBe('finishing');
    await act(async () => sent.forEach((r) => r(''))); // the chunk recording then, back
    await settle();
    expect(d.state).toBe('idle');
    expect(d.startedAt).toBeUndefined();
  });

  it('the chunks out, and the words just put in the box', async () => {
    await act(async () => d.toggle());
    await settle();
    expect(d.pending).toBe(0);
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => vi.advanceTimersByTime(1000));
    expect(d.pending).toBe(2);
    vi.setSystemTime(12_500);
    await act(async () => sent[0]!('one'));
    await settle();
    expect(d.pending).toBe(1);
    expect(d.heard).toEqual({ text: 'one', at: 12_500 });
    await act(async () => sent[1]!('two'));
    await settle();
    expect(d.pending).toBe(0);
    expect(d.heard?.text).toBe('two');
    expect(value).toBe('one two');
  });

  it('the sound level while it records; none after', async () => {
    expect(d.level()).toBe(0);
    await act(async () => d.toggle());
    await settle();
    expect(d.level()).toBe(0.2);
    level = 0.4;
    expect(d.level()).toBe(0.4);
    await act(async () => d.stop());
    expect(d.level()).toBe(0); // the microphone off at once
    await act(async () => sent.forEach((r) => r('')));
    await settle();
    expect(d.heard).toBeUndefined();
  });

  it('stopped by itself (a failed chunk), it shows finishing until the chunks out are back', async () => {
    await act(async () => d.toggle());
    await settle();
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => vi.advanceTimersByTime(1000));
    await act(async () => failing[0]!(new Error('server down')));
    await settle();
    expect(d.state).toBe('finishing');
    expect(d.level()).toBe(0);
    await act(async () => sent[1]!(''));
    await settle();
    expect(d.state).toBe('idle');
  });
});
