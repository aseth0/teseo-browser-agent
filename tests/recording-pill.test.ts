// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { showRecordingPill } from '../src/recording/pill';

// The pill a recording shows on the page it records: injected, so its shadow root is closed. The test
// keeps the root it gets and stands in for the extension's runtime.
let roots: ShadowRoot[] = [];
const attach = Element.prototype.attachShadow;
vi.spyOn(Element.prototype, 'attachShadow').mockImplementation(function (this: Element, init: ShadowRootInit) {
  const root = attach.call(this, init);
  roots.push(root);
  return root;
});
let onMessage: ((msg: unknown) => void)[] = [];
const sendMessage = vi.fn(async (_m: unknown) => ({ opened: true }));
(globalThis as unknown as { chrome: unknown }).chrome = {
  runtime: {
    sendMessage,
    onMessage: { addListener: (l: (m: unknown) => void) => onMessage.push(l), removeListener: (l: (m: unknown) => void) => (onMessage = onMessage.filter((x) => x !== l)) },
  },
};
const types = { stop: 'stop-it', update: 'pill-update' };
const pills = () => document.querySelectorAll('ba-recording');
const text = () => roots.at(-1)!.textContent ?? '';
const tell = (m: Record<string, unknown>) => onMessage.forEach((l) => l({ type: types.update, ...m }));

beforeEach(() => {
  for (const p of pills()) p.remove();
  roots = [];
  onMessage = [];
  sendMessage.mockClear();
  delete (window as unknown as Record<string, unknown>)['ba-recording-pill'];
});

describe('the recording pill', () => {
  it('shows once, with the count and the time', () => {
    showRecordingPill(types, { kind: 'recording', calls: 0, leftOut: 0, startedAt: Date.now() });
    showRecordingPill(types, { kind: 'recording', calls: 2, leftOut: 0, startedAt: Date.now() });
    expect(pills()).toHaveLength(1);
    expect(text()).toContain('Recording · 2 calls · 0:00');
  });
  it('follows the updates, one call in the singular', () => {
    showRecordingPill(types, { kind: 'recording', calls: 0, leftOut: 0, startedAt: Date.now() });
    tell({ calls: 1, leftOut: 0, startedAt: Date.now() });
    expect(text()).toContain('Recording · 1 call · 0:00');
    tell({ calls: 3, leftOut: 0, startedAt: Date.now() - 65_000 });
    expect(text()).toContain('3 calls · 1:05');
  });
  it('the page having rewritten its document, shows anew and stops the old one', () => {
    const cleared = vi.spyOn(globalThis, 'clearInterval');
    showRecordingPill(types, { kind: 'recording', calls: 0, leftOut: 0, startedAt: Date.now() });
    document.querySelector('ba-recording')!.remove(); // the page replaced its body: the pill went with it
    showRecordingPill(types, { kind: 'recording', calls: 5, leftOut: 0, startedAt: Date.now() });
    expect(pills()).toHaveLength(1);
    expect(text()).toContain('5 calls');
    expect(onMessage).toHaveLength(1); // the old one no longer listens
    expect(cleared).toHaveBeenCalledTimes(1); // nor ticks
    tell({ calls: 6, leftOut: 0, startedAt: Date.now() });
    expect(text()).toContain('6 calls');
    cleared.mockRestore();
  });
  it('goes away when told', () => {
    showRecordingPill(types, { kind: 'recording', calls: 0, leftOut: 0, startedAt: Date.now() });
    tell({ off: true });
    expect(pills()).toHaveLength(0);
    expect(onMessage).toHaveLength(0);
  });
  it('Stop asks only on a real click', async () => {
    showRecordingPill(types, { kind: 'recording', calls: 0, leftOut: 0, startedAt: Date.now() });
    const stop = roots.at(-1)!.querySelector('button')!;
    stop.click(); // a script's click: not trusted
    expect(sendMessage).not.toHaveBeenCalled();
    stop.dispatchEvent(Object.assign(new MouseEvent('click'), {}));
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("the pill on a tab whose audio is captured", () => {
  beforeEach(() => {
    for (const p of document.querySelectorAll('ba-audio')) p.remove();
    delete (window as unknown as Record<string, unknown>)['ba-audio-pill'];
  });
  it('its time, beside a recording\'s pill, and its Stop on your own click only', () => {
    showRecordingPill(types, { kind: 'recording', calls: 1, leftOut: 0, startedAt: Date.now() });
    showRecordingPill(types, { kind: 'audio', startedAt: Date.now() - 42_000, text: false, waves: false });
    expect(pills()).toHaveLength(1);
    const pill = document.querySelector<HTMLElement>('ba-audio')!;
    expect(text()).toContain('Audio · 0:42');
    expect(text()).not.toContain('call');
    expect(pill.style.getPropertyValue('top')).toBe('48px');
    const stop = roots.at(-1)!.querySelector('button')!;
    stop.click(); // a script's: not trusted
    expect(sendMessage).not.toHaveBeenCalled();
    tell({ off: true });
    expect(document.querySelector('ba-audio')).toBeNull();
  });
  it('alone by default: no transcript or waves unless chosen', () => {
    showRecordingPill(types, { kind: 'audio', startedAt: Date.now(), text: false, waves: false });
    expect(roots.at(-1)!.querySelector('section')).toBeNull();
  });
  it('with the transcript: the lines it is told, as text, never as markup', () => {
    showRecordingPill(types, { kind: 'audio', startedAt: Date.now(), text: true, waves: false });
    const said = roots.at(-1)!.querySelector('p')!;
    expect(said.textContent).toBe('Listening…');
    expect(roots.at(-1)!.querySelector('figure')).toBeNull();
    tell({ lines: ['[0:30] <img src=x>', '[0:34] two'] });
    expect(said.textContent).toBe('[0:30] <img src=x>\n[0:34] two');
    expect(said.querySelector('img')).toBeNull();
  });
  it('with waves: each level it is told comes in at the right, the older ones moving left', () => {
    showRecordingPill(types, { kind: 'audio', startedAt: Date.now(), text: true, waves: true });
    const bars = [...roots.at(-1)!.querySelectorAll<HTMLElement>('figure b')];
    expect(bars.length).toBeGreaterThan(10);
    const height = (i: number) => parseFloat(bars.at(i)!.style.height);
    tell({ level: 0.25 });
    const first = height(-1);
    expect(first).toBeGreaterThan(50);
    tell({ level: 0 });
    expect(height(-2)).toBe(first);
    expect(height(-1)).toBeLessThan(5);
    tell({ level: 9 });
    expect(height(-1)).toBe(100);
  });
});
