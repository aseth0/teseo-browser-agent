// A theme's colors for each mode (Appearance.palette), as the CSS variables of ui/tokens.css they set,
// and the text on the accent, on the tag and on the busy color: white or near black, whichever reads
// better on it (WCAG contrast). Used by the side panel and the options page (ui/appearance) and by the
// page widget (widget/ui/theme).
import type { Appearance } from '../storage/settings-types';
import { FONT_VARS, fontVars } from './fonts';

// What a palette may set, by the variable's name without "--".
export const PALETTE_KEYS = [
  'bg', 'surface', 'border', 'fg', 'muted', 'user', 'accent',
  'danger', 'tag', 'ok', 'warn',
  'md-strong', 'md-em', 'md-code', 'md-code-bg',
  'c-page', 'c-tool', 'c-model', 'c-you', 'c-known', 'c-write', 'c-system',
  'hl-keyword', 'hl-string', 'hl-number', 'hl-comment', 'hl-title', 'hl-attr', 'hl-tag',
] as const;

const LIGHT_TEXT = '#ffffff';
const DARK_TEXT = '#1b1b1d';

// The red, green and blue of a #rrggbb color, 0 to 255.
const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));

// Relative luminance of a #rrggbb color (WCAG 2).
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

// The text on an accent: white unless near black reads better on it.
export const onAccent = (accent: string) => (contrast(accent, LIGHT_TEXT) >= contrast(accent, DARK_TEXT) ? LIGHT_TEXT : DARK_TEXT);

// The accent of ui/tokens.css in each mode: a look's when it sets none.
export const TOKEN_ACCENT = { light: '#c2410c', dark: '#fb923c' } as const;
// Bold, italic and inline code of ui/tokens.css in each mode: a look's when it sets none.
export const TOKEN_TEXT = {
  light: { strong: '#9a3412', em: '#6d28d9', code: '#0e7490' },
  dark: { strong: '#fdba74', em: '#c4b5fd', code: '#67e8f9' },
} as const;
// The background, surface and text colors of ui/tokens.css in each mode: a look's when it sets none.
export const TOKEN_BASE = {
  light: { bg: '#ffffff', surface: '#f5f5f7', fg: '#1d1d1f' },
  dark: { bg: '#1b1b1d', surface: '#242427', fg: '#ececee' },
} as const;
type Base = { bg: string; surface: string; fg: string };

const AA = 4.5; // WCAG contrast for text

// A color part of the way to another (`share` of `to`, 0 to 1), as CSS color-mix in srgb.
function mix(from: string, to: string, share: number): string {
  const target = rgb(to);
  return `#${rgb(from).map((v, i) => Math.round(v * (1 - share) + target[i]! * share).toString(16).padStart(2, '0')).join('')}`;
}

// The accent as text (links, headings, what is chosen): itself when it reads at AA on the background
// and on the surface, else mixed toward the text color by the least share that does.
export function accentText(accent: string, base: Base): string {
  for (let percent = 0; percent <= 100; percent++) {
    const color = mix(accent, base.fg, percent / 100);
    if (contrast(color, base.bg) >= AA && contrast(color, base.surface) >= AA) return color;
  }
  return base.fg;
}

// Whether a look is dark: its mode, or the system's when it follows it (`systemDark`).
export const isDarkMode = (look: Appearance | undefined, systemDark: boolean) => {
  const mode = look?.mode ?? 'system';
  return mode === 'dark' || (mode === 'system' && systemDark);
};

// Every variable a look may set, so that what a theme set before goes when another is chosen.
const LOOK_VARS = [...PALETTE_KEYS.map((k) => `--${k}`), '--accent-text', '--md-heading', '--on-accent', '--on-tag', '--on-warn', ...FONT_VARS];

// The variables a look sets in a mode (none for a variable: the tokens' own). The accent chosen by hand
// goes over the palette's. The accent as text, which headings follow, reads at AA on the look's
// background (the tokens' own already do); the text on the accent (and on the palette's tag and busy
// colors) is worked out from it. Bold follows that accent (a palette's own bold when the look has no
// accent but the palette's); bold, italic and code set by hand go over both, made to read the same way.
// The tag, the color of what changes things (--c-write) and your messages' background follow the accent
// too; the other colors of what things are (--c-page, --c-tool…) come with a theme's palette.
// Its fonts too (look/fonts).
export function lookVars(look: Appearance | undefined, dark: boolean): Record<string, string | undefined> {
  const mode = dark ? 'dark' : 'light';
  const palette = (dark ? look?.palette?.dark : look?.palette?.light) ?? {};
  const accent = look?.accent ?? palette.accent;
  const tokens = TOKEN_BASE[mode];
  const base = { bg: palette.bg ?? tokens.bg, surface: palette.surface ?? tokens.surface, fg: palette.fg ?? tokens.fg };
  const own = accent || palette.bg || palette.surface || palette.fg; // else the tokens' own, which read
  const text = own ? accentText(accent ?? TOKEN_ACCENT[mode], base) : undefined;
  const readable = (color: string | undefined) => color && accentText(color, base);
  // The tag ("Only when") and what changes things (write) go with the accent, unless the palette sets them.
  const tag = palette.tag ?? accent;
  return {
    ...Object.fromEntries(PALETTE_KEYS.map((k) => [`--${k}`, palette[k]])),
    '--accent': accent,
    '--accent-text': text,
    '--md-heading': text,
    '--md-strong': readable(look?.strong) ?? (look?.accent ? text : palette['md-strong']),
    '--md-em': readable(look?.em) ?? palette['md-em'],
    '--md-code': readable(look?.code) ?? palette['md-code'],
    ...fontVars(look),
    '--on-accent': accent && onAccent(accent),
    '--tag': tag,
    '--on-tag': tag && onAccent(tag),
    '--c-write': palette['c-write'] ?? (accent ? text : undefined),
    // Your messages: a tint of the accent on the background, unless the palette has one.
    '--user': palette.user ?? (accent ? mix(base.bg, accent, dark ? 0.16 : 0.1) : undefined),
    '--on-warn': palette.warn && onAccent(palette.warn),
  };
}

// The variables set on an element (the document's root, the widget's hosts), the others taken off.
export function setLookVars(el: HTMLElement, vars: Record<string, string | undefined>): void {
  for (const name of LOOK_VARS) {
    const value = vars[name];
    if (value) el.style.setProperty(name, value);
    else el.style.removeProperty(name);
  }
}
