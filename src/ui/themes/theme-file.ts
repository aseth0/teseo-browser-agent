// Settings → Appearance → Theme: themes as JSON files to share them. One theme: { "type":
// "browser-agent-theme", "version": 2, "name", mode?, accent?, highlights?, palette?, strong?, em?, code?,
// the bubble's look: bubbleIcon?, bubbleFace?, bubbleShape?, … (BUBBLE_KEYS), and its fonts: fontText?,
// fontCode?, … (FONT_KEYS) }; several: { type, version, "themes": [{ name, … }] }.
// Version 1 (without palette) is still read. An import is checked strictly: what is not valid is left
// out, saying why.
import { isObject } from '../../core/util';
import type { Origin } from '../../core/model-texts';
import type { Appearance, CustomTheme, ThemePalette } from '../../storage/settings-types';
import { BUBBLE_ICONS } from '../../widget/bubble-icons';
import { ACTIONS_LABELS, ACTIONS_LAYOUTS, ACTIONS_SHAPES, ACTIONS_SIZES } from '../../widget/actions-look';
import { BUBBLE_EYES, BUBBLE_FACES, BUBBLE_HATS, BUBBLE_MOUTHS, BUBBLE_SHAPES, BUBBLE_THINKING } from '../../widget/bubble-look';
import { safeSvg } from '../../widget/svg-safe';
import { ORIGIN_INFO } from '../origins';
import { PALETTE_KEYS } from '../../look/palette';
import { CODE_FONTS, FONT_KEYS, FONT_SCOPES, fontNameOk, TEXT_FONTS } from '../../look/fonts';
import { BUBBLE_KEYS, TEXT_COLOR_KEYS, findTheme, isBuiltinTheme, MAX_THEME_NAME, MAX_THEMES, PALETTE_MODES, q, saveTheme, themeFields, type BubbleKey } from './theme-model';

export const THEME_FILE_TYPE = 'browser-agent-theme';
export const THEME_FILE_VERSION = 2;
const VERSIONS: unknown[] = [1, THEME_FILE_VERSION]; // what an import reads
const MAX_THEME_JSON = 100 * 1024; // bytes of JSON to import

const COLOR = /^#[0-9a-f]{6}$/i;
const MODES: NonNullable<Appearance['mode']>[] = ['system', 'light', 'dark'];
const FIELDS = ['name', 'mode', 'accent', 'highlights', 'palette', ...TEXT_COLOR_KEYS, ...BUBBLE_KEYS, ...FONT_KEYS];

const fileOf = (theme: CustomTheme) => ({ name: theme.name, ...themeFields(theme) });

export function exportTheme(theme: CustomTheme): string {
  return JSON.stringify({ type: THEME_FILE_TYPE, version: THEME_FILE_VERSION, ...fileOf(theme) }, null, 2);
}

export function exportThemes(themes: CustomTheme[]): string {
  return JSON.stringify({ type: THEME_FILE_TYPE, version: THEME_FILE_VERSION, themes: themes.map(fileOf) }, null, 2);
}

// A theme's palette, its invalid colors left out (said with `drop`); none when nothing of it is valid.
function readPalette(raw: unknown, drop: (what: string) => void): ThemePalette | undefined {
  if (!isObject(raw)) {
    drop('palette: not an object of light and dark colors');
    return undefined;
  }
  const palette: ThemePalette = {};
  for (const [mode, colors] of Object.entries(raw)) {
    if (!PALETTE_MODES.includes(mode as never)) drop(`palette "${mode}": not light or dark`);
    else if (!isObject(colors)) drop(`palette ${mode}: not an object of colors`);
    else {
      const kept: Record<string, string> = {};
      for (const [key, color] of Object.entries(colors)) {
        if (!PALETTE_KEYS.includes(key as never)) drop(`palette ${mode} "${key}": not a color a theme sets`);
        else if (typeof color !== 'string' || !COLOR.test(color)) drop(`palette ${mode} "${key}": ${JSON.stringify(color)} is not a #rrggbb color`);
        else kept[key] = color.toLowerCase();
      }
      if (Object.keys(kept).length) palette[mode as 'light' | 'dark'] = kept;
    }
  }
  return palette.light || palette.dark ? palette : undefined;
}

// One theme of a file, its invalid fields left out (said in `skipped`); a string: why it is left out whole.
function readTheme(raw: unknown, skipped: string[]): CustomTheme | string {
  if (!isObject(raw)) return 'an item that is not a theme (not a JSON object)';
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return 'a theme without a name';
  if (name.length > MAX_THEME_NAME) return `${q(name.slice(0, 20))}…: its name is longer than ${MAX_THEME_NAME} characters`;
  if (isBuiltinTheme(name)) return `${q(name)}: it is the name of a built-in theme`;
  if ((raw.type !== undefined && raw.type !== THEME_FILE_TYPE) || (raw.version !== undefined && !VERSIONS.includes(raw.version))) {
    return `${q(name)}: not a "${THEME_FILE_TYPE}" version ${VERSIONS.join(' or ')}`;
  }
  const theme: CustomTheme = { name };
  const drop = (what: string) => skipped.push(`${q(name)} ${what}`);
  for (const key of Object.keys(raw)) if (!FIELDS.includes(key) && key !== 'type' && key !== 'version') drop(`"${key}": not a theme field`);
  if (raw.mode !== undefined) {
    if (MODES.includes(raw.mode as never)) theme.mode = raw.mode as Appearance['mode'];
    else drop(`mode: ${JSON.stringify(raw.mode)} is not ${MODES.join(', ')}`);
  }
  if (raw.accent !== undefined) {
    if (typeof raw.accent === 'string' && COLOR.test(raw.accent)) theme.accent = raw.accent.toLowerCase();
    else drop(`accent: ${JSON.stringify(raw.accent)} is not a #rrggbb color`);
  }
  if (raw.highlights !== undefined) {
    if (!isObject(raw.highlights)) drop('highlights: not an object of colors by origin');
    else {
      const highlights: Partial<Record<Origin, string>> = {};
      for (const [origin, color] of Object.entries(raw.highlights)) {
        if (!Object.hasOwn(ORIGIN_INFO, origin)) drop(`highlight "${origin}": not a Layers origin`);
        else if (typeof color !== 'string' || !COLOR.test(color)) drop(`highlight "${origin}": ${JSON.stringify(color)} is not a #rrggbb color`);
        else highlights[origin as Origin] = color.toLowerCase();
      }
      if (Object.keys(highlights).length) theme.highlights = highlights;
    }
  }
  if (raw.palette !== undefined) {
    const palette = readPalette(raw.palette, drop);
    if (palette) theme.palette = palette;
  }
  for (const key of TEXT_COLOR_KEYS) {
    const color = raw[key];
    if (color === undefined) continue;
    if (typeof color === 'string' && COLOR.test(color)) theme[key] = color.toLowerCase();
    else drop(`${key}: ${JSON.stringify(color)} is not a #rrggbb color`);
  }
  for (const key of BUBBLE_KEYS) if (raw[key] !== undefined) readBubbleField(theme, key, raw[key], drop);
  for (const key of FONT_KEYS) if (raw[key] !== undefined) readFontField(theme, key, raw[key], drop);
  return theme;
}

const oneOf = (table: Record<string, unknown>) => (v: unknown) => typeof v === 'string' && Object.hasOwn(table, v);
const among = (list: readonly string[]) => (v: unknown) => typeof v === 'string' && list.includes(v);
const isBoolean = (v: unknown) => typeof v === 'boolean';
// Each bubble field: whether a value is valid, and what it must be (said when it is not).
const BUBBLE_CHECKS: Record<Exclude<BubbleKey, 'bubbleSvg'>, [check: (v: unknown) => boolean, what: string]> = {
  bubbleIcon: [oneOf(BUBBLE_ICONS), "one of the bubble's icons"],
  bubbleFace: [among(BUBBLE_FACES), BUBBLE_FACES.join(' or ')],
  bubbleShape: [oneOf(BUBBLE_SHAPES), "one of the bubble's shapes"],
  bubbleEyes: [oneOf(BUBBLE_EYES), "one of the bubble's eyes"],
  bubbleMouth: [oneOf(BUBBLE_MOUTHS), "one of the bubble's mouths"],
  bubbleHat: [oneOf(BUBBLE_HATS), "one of the bubble's hats"],
  bubbleThinking: [among(BUBBLE_THINKING), BUBBLE_THINKING.join(', ')],
  bubbleColor: [(v) => typeof v === 'string' && COLOR.test(v), 'a #rrggbb color'],
  bubbleSvgUrl: [(v) => typeof v === 'string' && v.length <= 2048 && /^https?:\/\//i.test(v), 'an http or https address'],
  bubbleEyesFollow: [isBoolean, 'true or false'],
  bubbleCheeks: [isBoolean, 'true or false'],
  bubbleSvgBare: [isBoolean, 'true or false'],
  actionsShape: [among(ACTIONS_SHAPES), ACTIONS_SHAPES.join(', ')],
  actionsLayout: [among(ACTIONS_LAYOUTS), ACTIONS_LAYOUTS.join(', ')],
  actionsLabels: [among(ACTIONS_LABELS), ACTIONS_LABELS.join(' or ')],
  actionsSize: [among(Object.keys(ACTIONS_SIZES)), Object.keys(ACTIONS_SIZES).join(', ')],
};

// Each font field: whether a value is valid, and what it must be (said when it is not).
const isFontName = (v: unknown) => typeof v === 'string' && fontNameOk(v.trim());
const FONT_CHECKS: Record<(typeof FONT_KEYS)[number], [check: (v: unknown) => boolean, what: string]> = {
  fontText: [oneOf(TEXT_FONTS), Object.keys(TEXT_FONTS).join(', ')],
  fontCode: [oneOf(CODE_FONTS), Object.keys(CODE_FONTS).join(', ')],
  fontTextName: [isFontName, "a font's name (letters, digits, spaces, dots, dashes)"],
  fontCodeName: [isFontName, "a font's name (letters, digits, spaces, dots, dashes)"],
  fontScope: [among(FONT_SCOPES), FONT_SCOPES.join(' or ')],
};

function readFontField(theme: CustomTheme, key: (typeof FONT_KEYS)[number], value: unknown, drop: (what: string) => void) {
  const [valid, what] = FONT_CHECKS[key];
  if (!valid(value)) return drop(`${key}: ${JSON.stringify(value)} is not ${what}`);
  Object.assign(theme, { [key]: typeof value === 'string' ? value.trim() : value });
}

// One field of the bubble's look into the theme, or left out saying why. Its SVG made safe again.
function readBubbleField(theme: CustomTheme, key: BubbleKey, value: unknown, drop: (what: string) => void) {
  if (key === 'bubbleSvg') {
    const check = typeof value === 'string' ? safeSvg(value) : { error: 'not text' };
    if ('error' in check) return drop(`bubble SVG: ${check.error}`);
    if (check.removed.length) drop(`from its bubble SVG: ${check.removed.join(', ')}`);
    theme.bubbleSvg = check.svg;
    return;
  }
  const [valid, what] = BUBBLE_CHECKS[key];
  if (!valid(value)) return drop(`${key}: ${JSON.stringify(value)} is not ${what}`);
  Object.assign(theme, { [key]: key === 'bubbleColor' ? (value as string).toLowerCase() : value });
}

// The themes in a theme file, and what was left out, with why. Throws when it is not a theme file
// at all: too large, not JSON, another type or version, too many themes.
export function parseThemes(json: string): { themes: CustomTheme[]; skipped: string[] } {
  const bytes = new TextEncoder().encode(json).length;
  if (bytes > MAX_THEME_JSON) throw new Error(`Too large for a theme file: ${Math.ceil(bytes / 1024)} KB, at most ${MAX_THEME_JSON / 1024} KB.`);
  const parsed = JSON.parse(json) as unknown;
  if (!isObject(parsed) || parsed.type !== THEME_FILE_TYPE) throw new Error(`Not a theme file: its "type" must be "${THEME_FILE_TYPE}".`);
  if (!VERSIONS.includes(parsed.version)) throw new Error(`Theme file version ${JSON.stringify(parsed.version)}: only version ${VERSIONS.join(' or ')} can be imported.`);
  let list: unknown[];
  if (parsed.themes === undefined) list = [parsed];
  else if (!Array.isArray(parsed.themes)) throw new Error('Its "themes" must be a list.');
  else if (parsed.themes.length > MAX_THEMES) throw new Error(`Too many themes: ${parsed.themes.length}, at most ${MAX_THEMES} in a file.`);
  else list = parsed.themes;
  const themes: CustomTheme[] = [];
  const skipped: string[] = [];
  for (const raw of list) {
    const theme = readTheme(raw, skipped);
    if (typeof theme === 'string') skipped.push(theme);
    else if (findTheme(themes, theme.name)) skipped.push(`${q(theme.name)} a second time: a file has each name once`);
    else themes.push(theme);
  }
  return { themes, skipped };
}

// The saved themes with those imported: each in place of the one of its name, or last while there is room.
export function importThemes(existing: CustomTheme[], read: { themes: CustomTheme[]; skipped: string[] }) {
  let themes = existing;
  const names: string[] = [];
  const skipped = [...read.skipped];
  for (const theme of read.themes) {
    if (!findTheme(themes, theme.name) && themes.length >= MAX_THEMES) skipped.push(`${q(theme.name)}: at most ${MAX_THEMES} saved themes`);
    else {
      themes = saveTheme(themes, theme);
      names.push(q(theme.name));
    }
  }
  return { themes, names, skipped };
}

// What an import did, as ImportExport shows it: those saved, and those left out, with why.
export function importedThemes(names: string[], skipped: string[]) {
  const said = names.length ? `Imported ${names.join(', ')}: pick ${names.length > 1 ? 'one' : 'it'} in Theme to use it.` : 'No theme imported.';
  return { said: [said, ...skipped.map((s) => `Left out ${s}.`)].join('\n'), all: names.length > 0 && !skipped.length };
}
