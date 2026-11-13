import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { accentText, contrast, lookVars, onAccent, PALETTE_KEYS, TOKEN_ACCENT, TOKEN_BASE } from '../src/look/palette';
import { exportTheme, parseThemes } from '../src/ui/themes/theme-file';
import { isThemeOf, lookWithTheme } from '../src/ui/themes/theme-model';
import { THEME_PRESETS } from '../src/ui/themes/presets';

// A theme's palette for each mode, the text on the accent, and the Flexoki preset's contrast.
const flexoki = THEME_PRESETS.find((p) => p.name === 'Flexoki')!;
const file = (theme: object, version = 2) => JSON.stringify({ type: 'browser-agent-theme', version, ...theme });

describe('the text on the accent', () => {
  it('is white unless near black reads better on it', () => {
    expect(onAccent('#c2410c')).toBe('#ffffff');
    expect(onAccent('#fb923c')).toBe('#1b1b1d'); // the dark theme's: white was 2.26:1
    expect(onAccent('#facc15')).toBe('#1b1b1d');
    expect(onAccent('#1d4ed8')).toBe('#ffffff');
    expect(contrast('#ffffff', '#000000')).toBeCloseTo(21);
  });
});

describe('a look', () => {
  it('sets the palette of its mode, the accent chosen by hand over it, and the text on the accent', () => {
    const look = { palette: flexoki.palette };
    // Its light accent reads at 4.22 on its surface: as text, a little darker (headings too).
    expect(lookVars(look, false)).toMatchObject({ '--bg': '#fffcf0', '--accent': '#bc5215', '--accent-text': '#b34f15', '--md-heading': '#b34f15', '--on-accent': '#ffffff' });
    expect(lookVars(look, true)).toMatchObject({ '--bg': '#100f0f', '--accent': '#da702c', '--on-accent': '#1b1b1d' });
    expect(lookVars({ ...look, accent: '#1d4ed8' }, true)).toMatchObject({ '--bg': '#100f0f', '--accent': '#1d4ed8', '--on-accent': '#ffffff' });
    // The state colors: set as the palette has them, the text on the tag and on the busy color worked out.
    const states = { palette: { light: { danger: '#b91c1c', tag: '#fde68a', ok: '#15803d', warn: '#92400e' } } };
    expect(lookVars(states, false)).toMatchObject({ '--danger': '#b91c1c', '--tag': '#fde68a', '--on-tag': '#1b1b1d', '--ok': '#15803d', '--warn': '#92400e', '--on-warn': '#ffffff' });
    expect(lookVars(states, true)).toMatchObject({ '--tag': undefined, '--on-tag': undefined, '--warn': undefined, '--on-warn': undefined });
    // A color it does not know (a newer build's, in the shared profile): not set.
    expect(lookVars({ palette: { light: { shadow: '#000000' } } }, false)).not.toHaveProperty('--shadow');
    // None: every variable taken off, so the tokens' own show.
    expect(Object.values(lookVars(undefined, false)).every((v) => v === undefined)).toBe(true);
  });
});

describe('the accent as text', () => {
  const read = (vars: Record<string, string | undefined>, mode: 'light' | 'dark') => {
    const base = { ...TOKEN_BASE[mode], ...Object.fromEntries(['bg', 'surface', 'fg'].filter((k) => vars[`--${k}`]).map((k) => [k, vars[`--${k}`]!])) };
    const text = vars['--accent-text'] ?? TOKEN_ACCENT[mode];
    return [contrast(text, base.bg), contrast(text, base.surface)];
  };

  it('reads at AA on the background and the surface with every built-in theme, in both modes', () => {
    for (const preset of THEME_PRESETS) {
      for (const dark of [false, true]) {
        const mode = dark ? 'dark' : 'light';
        for (const c of read(lookVars(preset, dark), mode)) expect(c, `${preset.name} ${mode}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it('is the accent when it reads, else the accent mixed toward the text color', () => {
    expect(accentText('#c2410c', TOKEN_BASE.light)).toBe('#c2410c');
    const grape = lookVars({ accent: '#7c3aed' }, true);
    expect(grape['--accent']).toBe('#7c3aed'); // buttons keep it
    expect(grape['--accent-text']).toBe('#a073ed'); // 3.02 on the dark background, as it was
    expect(grape['--md-heading']).toBe('#a073ed');
    for (const c of read(grape, 'dark')) expect(c).toBeGreaterThanOrEqual(4.5);
    // Nothing chosen: the tokens' own, which read already.
    expect(lookVars({}, true)['--accent-text']).toBeUndefined();
    for (const mode of ['light', 'dark'] as const) for (const c of read({}, mode)) expect(c).toBeGreaterThanOrEqual(4.5);
  });
});

describe('Flexoki', () => {
  it('reads well in both modes (WCAG AA)', () => {
    for (const mode of ['light', 'dark'] as const) {
      const p = flexoki.palette![mode]!;
      for (const key of ['fg', 'muted', 'md-strong', 'md-em', 'md-code', 'accent'] as const) expect(contrast(p[key]!, p.bg!), `${mode} ${key}`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p.fg!, p.user!), `${mode} your messages`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(p['md-code']!, p['md-code-bg']!), `${mode} code`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(onAccent(p.accent!), p.accent!), `${mode} on the accent`).toBeGreaterThanOrEqual(4.5);
      expect(Object.keys(p).every((k) => (PALETTE_KEYS as readonly string[]).includes(k))).toBe(true);
    }
  });

  it('is chosen, and another theme takes its palette off', () => {
    const chosen = lookWithTheme({ mode: 'dark' }, flexoki);
    expect(isThemeOf(chosen, flexoki)).toBe(true);
    expect(isThemeOf(chosen, THEME_PRESETS[0]!)).toBe(false);
    const back = lookWithTheme(chosen, THEME_PRESETS[0]!);
    expect(back.palette).toBeUndefined();
    expect(back.mode).toBe('dark');
  });
});

describe('theme files with a palette', () => {
  it('export and import it, leaving out what is not valid', () => {
    const theme = { name: 'Ink', palette: { light: { bg: '#FFFCF0', fg: '#100f0f' }, dark: { bg: '#100f0f' } } };
    expect(parseThemes(exportTheme(theme)).themes[0]!.palette).toEqual({ light: { bg: '#fffcf0', fg: '#100f0f' }, dark: { bg: '#100f0f' } });
    const read = parseThemes(file({ name: 'Bad', palette: { light: { bg: 'red', shadow: '#000000', fg: '#111111' }, sepia: {} } }));
    expect(read.themes[0]!.palette).toEqual({ light: { fg: '#111111' } });
    expect(read.skipped).toEqual([
      '"Bad" palette light "bg": "red" is not a #rrggbb color',
      '"Bad" palette light "shadow": not a color a theme sets',
      '"Bad" palette "sepia": not light or dark',
    ]);
  });

  it('carry the state colors', () => {
    const theme = { name: 'States', palette: { light: { danger: '#B91C1C', tag: '#9a3412', ok: '#15803d', warn: '#f59e0b' }, dark: { danger: '#f87171' } } };
    const read = parseThemes(exportTheme(theme));
    expect(read.themes[0]!.palette).toEqual({ light: { danger: '#b91c1c', tag: '#9a3412', ok: '#15803d', warn: '#f59e0b' }, dark: { danger: '#f87171' } });
    expect(read.skipped).toEqual([]);
  });

  it('still reads version 1', () => {
    expect(parseThemes(file({ name: 'Old', accent: '#7c3aed' }, 1)).themes).toEqual([{ name: 'Old', accent: '#7c3aed' }]);
  });
});

describe('PALETTE_KEYS', () => {
  it('are variables of ui/tokens.css in both modes', () => {
    const css = readFileSync(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
    const dark = css.slice(css.indexOf(':root[data-theme="dark"] {'));
    for (const key of PALETTE_KEYS) {
      expect(css.slice(0, css.indexOf(':root[data-theme="dark"] {')), `light --${key}`).toMatch(new RegExp(`--${key}:`));
      expect(dark, `dark --${key}`).toMatch(new RegExp(`--${key}:`));
    }
  });
});

describe('TOKEN_ACCENT and TOKEN_BASE', () => {
  it('are the colors of ui/tokens.css in each mode', () => {
    const css = readFileSync(new URL('../src/ui/tokens.css', import.meta.url), 'utf8');
    const colorIn = (selector: string, name: string) => css.slice(css.indexOf(`${selector} {`)).match(new RegExp(`--${name}:\\s*([^;]+);`))?.[1]?.trim();
    for (const [mode, selector] of [['light', ':root'], ['dark', ':root[data-theme="dark"]']] as const) {
      expect(colorIn(selector, 'accent')).toBe(TOKEN_ACCENT[mode]);
      for (const name of ['bg', 'surface', 'fg'] as const) expect(colorIn(selector, name), `${mode} ${name}`).toBe(TOKEN_BASE[mode][name]);
    }
  });
});
