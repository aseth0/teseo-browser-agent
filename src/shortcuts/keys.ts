// The keys set in Settings → Shortcuts for the extension's commands, besides the browser's own (manifest
// commands, which no API changes): a physical key (KeyboardEvent.code, so ⌥ on a Mac still matches the
// key whatever character it types) and its modifiers. Run by the extension's listeners: in the pages it
// may read (entrypoints/page-keys) and in its own pages (shortcuts/listen, from each page's main.tsx).
export type KeyCombo = { code: string; ctrl?: boolean; alt?: boolean; shift?: boolean; meta?: boolean };
// The keys set, by command name.
export type PageKeys = Readonly<Record<string, KeyCombo>>;
// An action in Settings → Shortcuts: its browser shortcut and its key set here, if any.
export type ShortcutRow = { name: string; label: string; browser?: KeyCombo; page?: KeyCombo };

type KeyEvent = Pick<KeyboardEvent, 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

const MODIFIER_CODES = /^(Control|Alt|Shift|Meta|OS)(Left|Right)?$|^(CapsLock|Fn|FnLock)$/;
const MODIFIERS = ['ctrl', 'alt', 'shift', 'meta'] as const;

// The key pressed; none for a modifier alone (still being chosen). Only the modifiers held are kept.
export function comboOf(e: KeyEvent): KeyCombo | undefined {
  if (!e.code || MODIFIER_CODES.test(e.code)) return undefined;
  return { code: e.code, ...(e.ctrlKey && { ctrl: true }), ...(e.altKey && { alt: true }), ...(e.shiftKey && { shift: true }), ...(e.metaKey && { meta: true }) };
}

export const sameCombo = (a: KeyCombo | undefined, b: KeyCombo | undefined) => !!a && !!b && a.code === b.code && MODIFIERS.every((m) => !!a[m] === !!b[m]);

// The command whose key was pressed, if any.
export function commandFor(keys: PageKeys, e: KeyEvent): string | undefined {
  const combo = comboOf(e);
  return combo && Object.keys(keys).find((name) => sameCombo(keys[name], combo));
}

const ARROWS: Record<string, [string, string]> = { ArrowUp: ['↑', 'Up'], ArrowDown: ['↓', 'Down'], ArrowLeft: ['←', 'Left'], ArrowRight: ['→', 'Right'] };

const keyName = (code: string, mac: boolean) => {
  const arrow = ARROWS[code];
  if (arrow) return mac ? arrow[0] : arrow[1];
  return code.replace(/^(Key|Digit)(?=.$)/, '');
};

// As macOS shows a key (⌃⌥⇧⌘S), or as the browser writes its shortcuts elsewhere (Ctrl+Alt+Shift+S).
export function formatCombo(c: KeyCombo, mac: boolean): string {
  if (mac) return `${c.ctrl ? '⌃' : ''}${c.alt ? '⌥' : ''}${c.shift ? '⇧' : ''}${c.meta ? '⌘' : ''}${keyName(c.code, true)}`;
  return [c.ctrl && 'Ctrl', c.alt && 'Alt', c.shift && 'Shift', c.meta && 'Win', keyName(c.code, false)].filter(Boolean).join('+');
}

const SYMBOLS: Record<string, (typeof MODIFIERS)[number]> = { '⌃': 'ctrl', '⌥': 'alt', '⇧': 'shift', '⌘': 'meta' };
const WORDS: Record<string, (typeof MODIFIERS)[number]> = { Ctrl: 'ctrl', MacCtrl: 'ctrl', Alt: 'alt', Option: 'alt', Shift: 'shift', Command: 'meta', Search: 'meta' };
const CHARACTERS: Record<string, string> = { ',': 'Comma', '.': 'Period' };

const codeOf = (key: string) => {
  if (/^[A-Z]$/i.test(key)) return `Key${key.toUpperCase()}`;
  if (/^\d$/.test(key)) return `Digit${key}`;
  const arrow = Object.keys(ARROWS).find((code) => ARROWS[code]!.includes(key));
  return arrow ?? CHARACTERS[key] ?? key;
};

// A browser shortcut as commands.getAll gives it: "⌥⇧A" on a Mac, "Alt+Shift+A" elsewhere. None when unset.
export function parseBrowserShortcut(shortcut: string): KeyCombo | undefined {
  if (!shortcut) return undefined;
  const combo: KeyCombo = { code: '' };
  let rest = shortcut;
  if (shortcut.includes('+')) {
    const parts = shortcut.split('+');
    rest = parts.pop() ?? '';
    for (const p of parts) if (WORDS[p]) combo[WORDS[p]] = true;
  } else {
    while (rest && SYMBOLS[rest[0]!]) {
      combo[SYMBOLS[rest[0]!]!] = true;
      rest = rest.slice(1);
    }
  }
  if (!rest) return undefined;
  combo.code = codeOf(rest);
  return combo;
}

// Keys that type a character with ⌥ on a Mac, or with AltGr (Ctrl+Alt) elsewhere, on many layouts (@, #, [, €…).
const TYPES_A_CHARACTER = /^(Digit\d|Minus|Equal|BracketLeft|BracketRight|Backslash|IntlBackslash|Semicolon|Quote|Backquote|Comma|Period|Slash|Space)$/;

// Why a key cannot be set here for the command `name`, if it cannot: what would keep it from reaching
// the page (the system's and the browser's keys, another action's browser shortcut, which the browser
// takes first), what typing needs, and a key set here already.
export function comboProblem(c: KeyCombo, name: string, rows: readonly ShortcutRow[], mac: boolean): string | undefined {
  const shown = formatCombo(c, mac);
  if (!c.ctrl && !c.alt && !c.meta) return mac ? 'Use ⌃, ⌥ or ⌘ with the key' : 'Use Ctrl or Alt with the key';
  if (mac) {
    if (c.meta && !c.ctrl && !c.alt) return `${shown}: ⌘ keys without ⌃ or ⌥ are the browser's or macOS's. Add ⌃ or ⌥`;
    if (c.alt && !c.ctrl && !c.meta && TYPES_A_CHARACTER.test(c.code)) return `${shown} types a character on many keyboards: pick another key`;
  } else {
    if (c.meta) return `${shown}: Windows key shortcuts are the system's. Pick another key`;
    if (c.ctrl && !c.alt) return `${shown}: Ctrl keys without Alt are the browser's. Add Alt`;
    if (c.alt && !c.ctrl && !c.shift) return `${shown}: Alt keys alone open the browser's menus. Add Shift`;
    if (c.ctrl && c.alt && TYPES_A_CHARACTER.test(c.code)) return `${shown} types a character on many keyboards: pick another key`;
  }
  const own = rows.find((r) => r.name === name);
  if (sameCombo(own?.browser, c)) return `${shown} is already its browser shortcut`;
  const browsers = rows.find((r) => r.name !== name && sameCombo(r.browser, c));
  if (browsers) return `The browser's ${shown} is ${browsers.label}: pick another key`;
  const here = rows.find((r) => r.name !== name && sameCombo(r.page, c));
  if (here) return `${shown} is already set here for ${here.label}`;
  return undefined;
}

const isCombo = (v: unknown): v is KeyCombo =>
  !!v && typeof v === 'object' && typeof (v as KeyCombo).code === 'string' && MODIFIERS.every((m) => ['boolean', 'undefined'].includes(typeof (v as KeyCombo)[m]));

// The keys read back from storage, which another version of the extension may have written.
export const isPageKeys = (v: unknown): v is PageKeys => !!v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every(isCombo);
