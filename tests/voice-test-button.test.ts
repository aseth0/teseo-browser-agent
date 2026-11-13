// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';
import type { TryResult } from '../src/voice/try-out';

// Settings → Voice's Test button: one test at a time, and leaving it stops the one running.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let access: (v: string | undefined) => void = () => undefined;
vi.mock('../src/providers/provider-access', () => ({ unreachable: () => new Promise((r) => (access = r)) }));
const runs: { signal: AbortSignal; done: (r: TryResult) => void }[] = [];
vi.mock('../src/voice/try-out', async (original) => ({
  ...(await original<object>()),
  tryTranscription: (_o: unknown, _d: unknown, signal: AbortSignal) => new Promise((done) => runs.push({ signal, done })),
}));
const { VoiceTest } = await import('../src/ui/VoiceTest');

const settings = { providers: [{ id: 'p', name: 'P', baseURL: 'https://api.example.test/v1', apiKey: 'k', defaultModel: '' }], systemPrompt: '', voice: { providerId: 'p', model: 'whisper-1' } } as Settings;

async function mount() {
  const el = document.createElement('ul');
  document.body.append(el);
  const root = createRoot(el);
  await act(async () => root.render(createElement(VoiceTest, { settings })));
  const button = [...el.querySelectorAll('button')].find((b) => b.textContent === 'Test')!;
  return { el, root, button };
}

describe("Settings → Voice's Test button", () => {
  it('starts one test for a double click', async () => {
    runs.length = 0;
    const { el, button } = await mount();
    await act(async () => {
      button.click();
      button.click();
    });
    await act(async () => access(undefined));
    expect(runs).toHaveLength(1);
    await act(async () => runs[0]!.done({ text: 'hello', peak: 0.04 }));
    expect(el.textContent).toContain('hello');
    expect(el.textContent).toContain('Loudest level: 0.040');
    expect(button.disabled).toBe(false);
  });
  it('stops the test running when it is left', async () => {
    runs.length = 0;
    const { root, button } = await mount();
    await act(async () => button.click());
    await act(async () => access(undefined));
    expect(runs[0]!.signal.aborted).toBe(false);
    act(() => root.unmount());
    expect(runs[0]!.signal.aborted).toBe(true);
  });
  it('shows "not measured" rather than a level it could not hear', async () => {
    runs.length = 0;
    const { el, button } = await mount();
    await act(async () => button.click());
    await act(async () => access(undefined));
    await act(async () => runs[0]!.done({ text: 'hi' }));
    expect(el.textContent).toContain('Loudest level: not measured');
  });
});
