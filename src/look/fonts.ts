// The fonts a look sets (Settings → Appearance → Fonts): one for text and one for code, from a short list
// of what the computer has (nothing is downloaded), or a font installed on it by name, before the
// chosen one. As CSS variables: --font-ui and --font-code everywhere (the side panel, the options page,
// the page widget), or only in the chat's messages (--font-msg, --font-msg-code).
import type { Appearance } from '../storage/settings-types';

export const TEXT_FONTS = {
  system: ['System', 'system-ui, -apple-system, sans-serif'],
  serif: ['Serif', 'ui-serif, "New York", Georgia, serif'],
  rounded: ['Rounded', 'ui-rounded, "SF Pro Rounded", system-ui, sans-serif'],
  humanist: ['Humanist', 'Seravek, "Gill Sans Nova", Ubuntu, Calibri, sans-serif'],
  mono: ['Monospace', 'ui-monospace, Menlo, monospace'],
} as const;

export const CODE_FONTS = {
  system: ['System mono', 'ui-monospace, SFMono-Regular, Menlo, monospace'],
  menlo: ['Menlo', 'Menlo, monospace'],
  sf: ['SF Mono', '"SF Mono", SFMono-Regular, ui-monospace, monospace'],
  courier: ['Courier', '"Courier New", Courier, monospace'],
} as const;

export type TextFont = keyof typeof TEXT_FONTS;
export type CodeFont = keyof typeof CODE_FONTS;
export const FONT_SCOPES = ['all', 'messages'] as const;
export type FontScope = (typeof FONT_SCOPES)[number];

export const MAX_FONT_NAME = 60; // characters
// A font's name as typed: letters, digits, spaces, dots, dashes and underscores (nothing that could end
// the CSS value it goes in).
export const fontNameOk = (name: string) => name.length <= MAX_FONT_NAME && /^[\p{L}\p{N} ._-]+$/u.test(name);

// The fields of a look that are its fonts: a theme that has any of them sets all of them.
export const FONT_KEYS = ['fontText', 'fontCode', 'fontTextName', 'fontCodeName', 'fontScope'] as const satisfies (keyof Appearance)[];

export const FONT_VARS = ['--font-ui', '--font-code', '--font-msg', '--font-msg-code'] as const;

// A list's font with the named one before it (when its name is fine). None: the default list's own.
function stack(list: Record<string, readonly [string, string]>, key: string | undefined, name: string | undefined): string | undefined {
  const named = name?.trim();
  const chosen = key && key !== 'system' && Object.hasOwn(list, key) ? list[key]![1] : undefined;
  if (named && fontNameOk(named)) return `"${named}", ${chosen ?? list.system![1]}`;
  return chosen;
}

// The font variables a look sets (none for one: the tokens' own).
export function fontVars(look: Appearance | undefined): Record<(typeof FONT_VARS)[number], string | undefined> {
  const text = stack(TEXT_FONTS, look?.fontText, look?.fontTextName);
  const code = stack(CODE_FONTS, look?.fontCode, look?.fontCodeName);
  const messages = look?.fontScope === 'messages';
  return {
    '--font-ui': messages ? undefined : text,
    '--font-code': messages ? undefined : code,
    '--font-msg': messages ? text : undefined,
    '--font-msg-code': messages ? code : undefined,
  };
}
