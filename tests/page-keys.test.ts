import { describe, expect, it } from 'vitest';
import { comboOf, comboProblem, commandFor, formatCombo, isPageKeys, parseBrowserShortcut, type ShortcutRow } from '../src/shortcuts/keys';

const key = (code: string, mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}, k = code) => ({
  code, key: k, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods,
});

describe('a key pressed', () => {
  it('is its physical key and its modifiers', () => {
    expect(comboOf(key('KeyS', { ctrlKey: true, altKey: true }, 'ß'))).toEqual({ code: 'KeyS', ctrl: true, alt: true });
  });
  it('a modifier alone is no key yet', () => {
    expect(comboOf(key('AltLeft', { altKey: true }, 'Alt'))).toBeUndefined();
    expect(comboOf(key('ShiftRight', { shiftKey: true }, 'Shift'))).toBeUndefined();
  });
});

describe('the command a key runs', () => {
  const keys = { 'capture-section': { code: 'KeyS', ctrl: true, alt: true } } as const;
  it('is the one set for exactly that key', () => {
    expect(commandFor(keys, key('KeyS', { ctrlKey: true, altKey: true }))).toBe('capture-section');
  });
  it('none with another modifier, or another key', () => {
    expect(commandFor(keys, key('KeyS', { ctrlKey: true, altKey: true, shiftKey: true }))).toBeUndefined();
    expect(commandFor(keys, key('KeyD', { ctrlKey: true, altKey: true }))).toBeUndefined();
  });
});

describe('a key as shown', () => {
  it('on a Mac, with its symbols in the order macOS shows them', () => {
    expect(formatCombo({ code: 'KeyA', alt: true, shift: true }, true)).toBe('⌥⇧A');
    expect(formatCombo({ code: 'Digit1', ctrl: true, meta: true }, true)).toBe('⌃⌘1');
    expect(formatCombo({ code: 'ArrowUp', ctrl: true, alt: true }, true)).toBe('⌃⌥↑');
  });
  it('elsewhere, as the browser writes its shortcuts', () => {
    expect(formatCombo({ code: 'KeyA', alt: true, shift: true }, false)).toBe('Alt+Shift+A');
    expect(formatCombo({ code: 'Comma', ctrl: true, alt: true }, false)).toBe('Ctrl+Alt+Comma');
    expect(formatCombo({ code: 'F5', alt: true, shift: true }, false)).toBe('Alt+Shift+F5');
  });
});

describe("the browser's own shortcut", () => {
  it('read as a Mac shows it', () => {
    expect(parseBrowserShortcut('⌥⇧A')).toEqual({ code: 'KeyA', alt: true, shift: true });
    expect(parseBrowserShortcut('⌘⇧Y')).toEqual({ code: 'KeyY', meta: true, shift: true });
  });
  it('read as other systems show it', () => {
    expect(parseBrowserShortcut('Alt+Shift+A')).toEqual({ code: 'KeyA', alt: true, shift: true });
    expect(parseBrowserShortcut('Ctrl+Shift+Comma')).toEqual({ code: 'Comma', ctrl: true, shift: true });
    expect(parseBrowserShortcut('Alt+Shift+7')).toEqual({ code: 'Digit7', alt: true, shift: true });
  });
  it('none when it is not set', () => {
    expect(parseBrowserShortcut('')).toBeUndefined();
  });
});

describe('a key set here, checked', () => {
  const rows: ShortcutRow[] = [
    { name: 'open-side-panel', label: 'Open Teseo', browser: { code: 'KeyA', alt: true, shift: true } },
    { name: 'capture-section', label: 'Screenshot a section', page: { code: 'KeyS', ctrl: true, alt: true } },
    { name: 'capture-full-page', label: 'Screenshot the whole page' },
  ];
  const problem = (combo: Parameters<typeof comboProblem>[0], mac = true, name = 'capture-full-page') => comboProblem(combo, name, rows, mac);

  it('a free key with Ctrl, Alt or ⌘ is fine', () => {
    expect(problem({ code: 'KeyP', ctrl: true, alt: true })).toBeUndefined();
    expect(problem({ code: 'KeyP', alt: true, shift: true }, false)).toBeUndefined();
  });
  it('needs a modifier other than Shift: a key alone, or with Shift, is typing', () => {
    expect(problem({ code: 'KeyP' })).toBe('Use ⌃, ⌥ or ⌘ with the key');
    expect(problem({ code: 'KeyP', shift: true }, false)).toBe('Use Ctrl or Alt with the key');
  });
  it("on a Mac, ⌘ with no ⌃ or ⌥ is the browser's or macOS's", () => {
    expect(problem({ code: 'KeyW', meta: true })).toMatch(/browser's or macOS's/);
    expect(problem({ code: 'KeyT', meta: true, shift: true })).toMatch(/browser's or macOS's/);
  });
  it("elsewhere, Ctrl with no Alt is the browser's, and so is Alt alone (its menus)", () => {
    expect(problem({ code: 'KeyK', ctrl: true }, false)).toMatch(/browser's/);
    expect(problem({ code: 'KeyD', alt: true }, false)).toMatch(/browser's/);
  });
  it("elsewhere, the Windows key is the system's", () => {
    expect(problem({ code: 'KeyE', meta: true, alt: true }, false)).toMatch(/system's/);
  });
  it('a key that types a character on many keyboards is refused', () => {
    expect(problem({ code: 'Digit2', alt: true })).toMatch(/types a character/); // ⌥2: @ on some Mac layouts
    expect(problem({ code: 'Digit2', ctrl: true, alt: true }, false)).toMatch(/types a character/); // AltGr+2
  });
  it("another action's browser shortcut: the browser takes it first", () => {
    expect(problem({ code: 'KeyA', alt: true, shift: true })).toBe("The browser's ⌥⇧A is Open Teseo: pick another key");
  });
  it("its own browser shortcut: nothing to add", () => {
    expect(comboProblem({ code: 'KeyA', alt: true, shift: true }, 'open-side-panel', rows, true)).toMatch(/already its browser shortcut/);
  });
  it('a key set here for another action', () => {
    expect(problem({ code: 'KeyS', ctrl: true, alt: true }, false)).toBe('Ctrl+Alt+S is already set here for Screenshot a section');
  });
  it('setting its own key again is fine', () => {
    expect(comboProblem({ code: 'KeyS', ctrl: true, alt: true }, 'capture-section', rows, true)).toBeUndefined();
  });
});

describe('the keys as stored', () => {
  it('read back only when they are keys', () => {
    expect(isPageKeys({ 'float-chat': { code: 'KeyF', ctrl: true, alt: true } })).toBe(true);
    expect(isPageKeys({})).toBe(true);
    expect(isPageKeys({ 'float-chat': { code: 3 } })).toBe(false);
    expect(isPageKeys({ 'float-chat': { code: 'KeyF', ctrl: 'yes' } })).toBe(false);
    expect(isPageKeys([])).toBe(false);
    expect(isPageKeys(null)).toBe(false);
  });
});
