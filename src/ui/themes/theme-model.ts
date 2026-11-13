// Settings → Appearance → Theme: a theme as an appearance (what it sets, choosing it, whether the
// appearance is it) and the themes the user saves (settings.customThemes). As JSON files: ui/themes/theme-file.
import type { Origin } from '../../core/model-texts';
import { sameName } from '../../storage/import';
import type { Appearance, CustomTheme, ThemePalette } from '../../storage/settings-types';
import { ORIGIN_INFO, ORIGINS } from '../origins';
import { PALETTE_KEYS } from '../../look/palette';
import { FONT_KEYS } from '../../look/fonts';
import { THEME_PRESETS } from './presets';

export const MAX_THEME_NAME = 60; // characters
export const MAX_THEMES = 50; // in a file, and saved

// The bubble's look and its actions' (Settings → Bubble): a theme that has any of it sets all of it.
export const BUBBLE_KEYS = [
  'bubbleIcon', 'bubbleFace', 'bubbleShape', 'bubbleEyes', 'bubbleEyesFollow', 'bubbleMouth', 'bubbleHat', 'bubbleCheeks', 'bubbleColor', 'bubbleThinking',
  'bubbleSvg', 'bubbleSvgUrl', 'bubbleSvgBare',
  'actionsShape', 'actionsLayout', 'actionsLabels', 'actionsSize',
] as const satisfies (keyof Appearance)[];
export type BubbleKey = (typeof BUBBLE_KEYS)[number];
// Every bubble field of Appearance is among them: the typecheck fails on one left out (it would not go
// with a theme), naming it.
type None<T extends never> = T;
export type BubbleKeysLeftOut = None<Exclude<Extract<keyof Appearance, `bubble${string}`>, BubbleKey>>;

// Bold, italic and code colors set by hand: choosing a theme sets them (none: its own).
export const TEXT_COLOR_KEYS = ['strong', 'em', 'code'] as const satisfies (keyof Appearance)[];

export const PALETTE_MODES = ['light', 'dark'] as const;
export const q = (name: string) => `"${name}"`;

// The bubble's look an appearance has: its fields that are set (false and empty are not).
const bubbleOf = (look: Appearance): Appearance => Object.fromEntries(BUBBLE_KEYS.filter((k) => look[k]).map((k) => [k, look[k]]));
const hasBubble = (look: Appearance) => BUBBLE_KEYS.some((k) => look[k]);
// Its fonts, the same way: a theme that has any of them sets all of them (a built-in theme has none).
const fontsOf = (look: Appearance): Appearance => Object.fromEntries(FONT_KEYS.filter((k) => look[k]).map((k) => [k, look[k]]));
const hasFonts = (look: Appearance) => FONT_KEYS.some((k) => look[k]);

// What a theme sets, from an appearance: its fields that are set, nothing else.
export function themeFields(look: Appearance): Appearance {
  return {
    ...(look.mode && { mode: look.mode }),
    ...(look.accent && { accent: look.accent }),
    ...(look.highlights && Object.keys(look.highlights).length > 0 && { highlights: { ...look.highlights } }),
    ...Object.fromEntries(TEXT_COLOR_KEYS.filter((k) => look[k]).map((k) => [k, look[k]])),
    ...bubbleOf(look),
    ...fontsOf(look),
    ...(look.palette && { palette: structuredClone(look.palette) }),
  };
}

export const themeFromLook = (name: string, look: Appearance): CustomTheme => ({ name: name.trim(), ...themeFields(look) });

// The appearance once a theme is chosen: its accent, text colors, highlights and palette (none: the
// defaults), and its mode, bubble look and fonts when it has them (a built-in theme never has: they are
// chosen apart).
export function lookWithTheme(look: Appearance, theme: Appearance): Appearance {
  // All of its bubble look and fonts, unset fields too: nothing of those shown before is left over.
  const all = (keys: readonly (keyof Appearance)[]): Appearance => Object.fromEntries(keys.map((k) => [k, theme[k]]));
  return {
    ...look, accent: theme.accent, highlights: theme.highlights, palette: theme.palette, ...all(TEXT_COLOR_KEYS),
    ...(theme.mode && { mode: theme.mode }), ...(hasBubble(theme) && all(BUBBLE_KEYS)), ...(hasFonts(theme) && all(FONT_KEYS)),
  };
}

// A palette as compared: its colors in lower case, by mode and key, in order.
const paletteKey = (p: ThemePalette | undefined) =>
  JSON.stringify(PALETTE_MODES.map((m) => PALETTE_KEYS.map((k) => p?.[m]?.[k]?.toLowerCase() ?? '')));

const colorOf = (highlights: Appearance['highlights'], origin: Origin) => highlights?.[origin] ?? ORIGIN_INFO[origin].color;

// Whether the appearance is what choosing that theme gives.
export function isThemeOf(look: Appearance, theme: Appearance): boolean {
  return (
    theme.accent?.toLowerCase() === look.accent?.toLowerCase() &&
    ORIGINS.every(({ origin }) => colorOf(theme.highlights, origin).toLowerCase() === colorOf(look.highlights, origin).toLowerCase()) &&
    (!theme.mode || theme.mode === (look.mode ?? 'system')) &&
    (!hasBubble(theme) || JSON.stringify(bubbleOf(theme)) === JSON.stringify(bubbleOf(look))) &&
    TEXT_COLOR_KEYS.every((k) => theme[k]?.toLowerCase() === look[k]?.toLowerCase()) &&
    (!hasFonts(theme) || JSON.stringify(fontsOf(theme)) === JSON.stringify(fontsOf(look))) &&
    paletteKey(theme.palette) === paletteKey(look.palette)
  );
}

// The name an export of the appearance gets: the saved theme it is, else "My theme".
export const lookName = (look: Appearance, themes: CustomTheme[] = []) => themes.find((t) => isThemeOf(look, t))?.name ?? 'My theme';

export const isBuiltinTheme = (name: string) => THEME_PRESETS.some((p) => sameName(p.name, name));
export const findTheme = (themes: CustomTheme[], name: string) => themes.find((t) => sameName(t.name, name));

// Why a theme cannot have that name (none: it can). One of the same name is replaced, after asking.
export function themeNameProblem(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the theme a name.';
  if (trimmed.length > MAX_THEME_NAME) return `A theme's name has at most ${MAX_THEME_NAME} characters.`;
  if (isBuiltinTheme(trimmed)) return `${q(trimmed)} is a built-in theme: choose another name.`;
  return undefined;
}

// The list with that theme saved: in place of the one of its name, or last. Throws when it cannot be.
export function saveTheme(themes: CustomTheme[], theme: CustomTheme): CustomTheme[] {
  const problem = themeNameProblem(theme.name);
  if (problem) throw new Error(problem);
  const saved = { ...theme, name: theme.name.trim() };
  const at = themes.findIndex((t) => sameName(t.name, saved.name));
  if (at >= 0) return themes.map((t, i) => (i === at ? saved : t));
  if (themes.length >= MAX_THEMES) throw new Error(`At most ${MAX_THEMES} saved themes: delete one first.`);
  return [...themes, saved];
}

export const deleteTheme = (themes: CustomTheme[], name: string) => themes.filter((t) => !sameName(t.name, name));
