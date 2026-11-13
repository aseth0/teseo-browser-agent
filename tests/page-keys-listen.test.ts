// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

// The keys set in Settings → Shortcuts, heard where they are pressed (a page, or one of the extension's
// own pages) and sent to the background, which runs their command.
const storage = fakeStorage();
const sendMessage = vi.fn(async (_m: unknown) => undefined);
const runtime: { id?: string; sendMessage: typeof sendMessage } = { id: 'ext', sendMessage };
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage, { runtime }) }));
const { listenKeysSetHere } = await import('../src/shortcuts/listen');
const { PAGE_KEY } = await import('../src/core/protocol');
const { PAGE_KEYS_KEY } = await import('../src/storage/keys');

const settled = () => new Promise((r) => setTimeout(r, 0));
// What the browser makes of a key pressed by the user (pages cannot make one: isTrusted, which jsdom
// does not let a test set): given to the listener as the window has it.
type Heard = (e: unknown) => void;
const added = vi.spyOn(window, 'addEventListener');
const heard = () => added.mock.calls.findLast(([type, , capture]) => type === 'keydown' && capture === true)?.[1] as unknown as Heard;
const press = (code: string, mods: KeyboardEventInit = {}, trusted = true, target: EventTarget = document.body) => {
  const e = { code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, repeat: false, isComposing: false, ...mods, isTrusted: trusted, target, defaultPrevented: false,
    preventDefault() { this.defaultPrevented = true; }, stopImmediatePropagation: vi.fn() };
  heard()(e);
  return e;
};

let stop: () => void;
beforeEach(async () => {
  stop?.();
  runtime.id = 'ext';
  storage.reset();
  sendMessage.mockClear();
  await storage.local.set({ [PAGE_KEYS_KEY]: { 'capture-section': { code: 'KeyS', ctrl: true, alt: true } } });
  stop = listenKeysSetHere();
  await settled();
});

describe('a key set here', () => {
  it('runs its command, and the page never gets it', () => {
    const e = press('KeyS', { ctrlKey: true, altKey: true });
    expect(sendMessage).toHaveBeenCalledWith({ type: PAGE_KEY, command: 'capture-section' });
    expect(e.defaultPrevented).toBe(true);
    expect(e.stopImmediatePropagation).toHaveBeenCalled();
  });
  it('other keys are left to the page', () => {
    const e = press('KeyS', { ctrlKey: true });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(e.defaultPrevented).toBe(false);
  });
  it('a key the page made up, held down (repeats) or composing text: nothing', () => {
    press('KeyS', { ctrlKey: true, altKey: true }, false);
    press('KeyS', { ctrlKey: true, altKey: true, repeat: true });
    press('KeyS', { ctrlKey: true, altKey: true, isComposing: true });
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it('changed in Settings: the new key at once', async () => {
    await storage.local.set({ [PAGE_KEYS_KEY]: { 'capture-section': { code: 'KeyD', ctrl: true, alt: true } } });
    press('KeyS', { ctrlKey: true, altKey: true });
    press('KeyD', { ctrlKey: true, altKey: true });
    expect(sendMessage.mock.calls).toEqual([[{ type: PAGE_KEY, command: 'capture-section' }]]);
  });
  it('being recorded in Settings: only recorded', () => {
    const recorder = document.createElement('button');
    recorder.dataset.keyRecorder = '';
    document.body.append(recorder);
    press('KeyS', { ctrlKey: true, altKey: true }, true, recorder);
    expect(sendMessage).not.toHaveBeenCalled();
    recorder.remove();
  });
  it('stored by another version as something else: no keys', async () => {
    await storage.local.set({ [PAGE_KEYS_KEY]: 'nonsense' });
    press('KeyS', { ctrlKey: true, altKey: true });
    expect(sendMessage).not.toHaveBeenCalled();
  });
  it('cut off from the extension (reloaded under the page): left to the new copy, and this one leaves', () => {
    const removed = vi.spyOn(window, 'removeEventListener');
    runtime.id = undefined;
    const e = press('KeyS', { ctrlKey: true, altKey: true });
    expect(e.defaultPrevented).toBe(false);
    expect(e.stopImmediatePropagation).not.toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
    expect(removed).toHaveBeenCalledWith('keydown', expect.any(Function), true);
  });
});
