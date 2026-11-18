// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Dictation } from '../src/entrypoints/sidepanel/useDictation';

// The strip in the message box while it dictates: the time, the waves, the words just in (or "…" while a
// chunk is out), Stop; once stopped, "Finishing dictation…" until the last chunk is in; nothing otherwise.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const { DictationStrip, HEARD_MS } = await import('../src/entrypoints/sidepanel/DictationStrip');

let root: Root;
let host: HTMLDivElement;
const stop = vi.fn();
const dictation = (d: Partial<Dictation>): Dictation => ({ state: 'recording', pending: 0, level: () => 0.25, toggle: vi.fn(), stop, startedAt: 10_000, ...d });
const show = (d: Partial<Dictation>) => act(() => root.render(createElement(DictationStrip, { dictation: dictation(d) })));
const strip = () => host.querySelector<HTMLElement>('[role="group"][aria-label="Dictation"]');
const text = (sel: string) => strip()?.querySelector(sel)?.textContent;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(10_000);
  host = document.createElement('div');
  root = createRoot(host);
  stop.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
});

describe('the dictation strip', () => {
  it('shows nothing unless it records or finishes', () => {
    show({ state: 'idle', startedAt: undefined });
    expect(strip()).toBeNull();
    show({ state: 'starting', startedAt: undefined });
    expect(strip()).toBeNull();
  });

  it('counts the time from the start', () => {
    show({});
    expect(text('.dictation-time')).toBe('0:00');
    act(() => vi.advanceTimersByTime(1000));
    expect(text('.dictation-time')).toBe('0:01');
    act(() => vi.advanceTimersByTime(64_000));
    expect(text('.dictation-time')).toBe('1:05');
  });

  it('draws the sound level as it comes', () => {
    show({});
    act(() => vi.advanceTimersByTime(200));
    const bars = [...strip()!.querySelectorAll<HTMLElement>('.dictation-waves b')];
    expect(bars).toHaveLength(16);
    expect(bars.at(-1)!.style.height).toBe('80%'); // sqrt(0.25) * 160, at most 100
  });

  it('the words just in for a moment, "…" while a chunk is out, else nothing', () => {
    show({ heard: { text: 'and Ana will bring the slides', at: 10_000 }, pending: 1 });
    expect(text('.dictation-heard')).toBe('and Ana will bring the slides');
    act(() => vi.advanceTimersByTime(HEARD_MS + 200)); // its clock ticks every 200 ms
    expect(text('.dictation-heard')).toBe('…');
    show({ heard: { text: 'and Ana will bring the slides', at: 10_000 }, pending: 0 });
    expect(text('.dictation-heard')).toBe('');
  });

  it("a new dictation starts with flat waves, not the last one's", () => {
    show({});
    act(() => vi.advanceTimersByTime(1000));
    show({ state: 'idle', startedAt: undefined });
    vi.setSystemTime(20_000);
    show({ startedAt: 20_000 });
    const heights = [...strip()!.querySelectorAll<HTMLElement>('.dictation-waves b')].map((b) => b.style.height);
    expect(new Set(heights)).toEqual(new Set(['0%']));
    expect(text('.dictation-time')).toBe('0:00');
  });

  it("Stop stops the dictation (not the agent's run), named apart from the run's Stop and the 🎤", () => {
    show({});
    const button = strip()!.querySelector('button')!;
    expect(button.textContent).toBe('Stop');
    expect(button.getAttribute('aria-label')).toBe('Stop dictation');
    act(() => button.click());
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('once stopped: "Finishing dictation…", Stop off', () => {
    show({ state: 'finishing', pending: 1 });
    expect(strip()!.classList).toContain('finishing');
    expect(strip()!.textContent).toContain('Finishing dictation…');
    expect(strip()!.querySelector('button')!.disabled).toBe(true);
  });
});
