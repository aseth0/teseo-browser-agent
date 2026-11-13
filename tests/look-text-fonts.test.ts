import { describe, expect, it } from 'vitest';
import { accentText, lookVars, TOKEN_BASE } from '../src/look/palette';
import { fontNameOk, fontVars } from '../src/look/fonts';
import { exportTheme, parseThemes } from '../src/ui/themes/theme-file';
import { isThemeOf, lookWithTheme, themeFromLook } from '../src/ui/themes/theme-model';
import { THEME_PRESETS } from '../src/ui/themes/presets';

// Bold, italic and code colors of a look, and its fonts (Settings → Appearance → Theme and Fonts).
const preset = (name: string) => THEME_PRESETS.find((p) => p.name === name)!;
const file = (theme: object) => JSON.stringify({ type: 'browser-agent-theme', version: 2, ...theme });

describe('text colors', () => {
  it('bold follows the accent; a theme brings its italic and code', () => {
    const ocean = lookWithTheme({}, preset('Ocean'));
    const light = lookVars(ocean, false);
    expect(light['--md-strong']).toBe(light['--accent-text']);
    expect(light).toMatchObject({ '--md-em': '#be185d', '--md-code': '#0f766e', '--md-code-bg': '#e6f6f4' });
    expect(lookVars(ocean, true)).toMatchObject({ '--md-em': '#f9a8d4', '--md-code': '#5eead4' });
    // Without an accent: the tokens' own (Default), or the palette's bold (Flexoki).
    expect(lookVars({}, false)['--md-strong']).toBeUndefined();
    expect(lookVars({ palette: preset('Flexoki').palette }, false)['--md-strong']).toBe('#bc5215');
    // An accent by hand over Flexoki: bold follows it.
    expect(lookVars({ palette: preset('Flexoki').palette, accent: '#1d4ed8' }, false)['--md-strong']).toBe('#1d4ed8');
  });

  it('set by hand go over the theme, made to read on its background', () => {
    const look = { ...lookWithTheme({}, preset('Ocean')), strong: '#ff0000', em: '#00aa00', code: '#ffff00' };
    const vars = lookVars(look, false);
    expect(vars['--md-strong']).toBe(accentText('#ff0000', TOKEN_BASE.light));
    expect(vars['--md-em']).toBe(accentText('#00aa00', TOKEN_BASE.light));
    expect(vars['--md-code']).not.toBe('#ffff00'); // yellow on white does not read: darkened
    // Choosing a theme again takes them off.
    expect(lookWithTheme(look, preset('Grape'))).toMatchObject({ strong: undefined, em: undefined, code: undefined });
  });
});

describe('the colors of what things are', () => {
  it('a theme brings them; the tag, write and your messages follow the accent', () => {
    const ocean = lookVars(lookWithTheme({}, preset('Ocean')), false);
    expect(ocean).toMatchObject({ '--c-tool': '#0369a1', '--c-model': '#4f46e5', '--tag': '#0284c7', '--c-write': ocean['--accent-text'] });
    expect(ocean['--user']).toMatch(/^#[0-9a-f]{6}$/);
    expect(lookVars(lookWithTheme({}, preset('Rose')), true)).toMatchObject({ '--c-tool': '#f9a8d4', '--c-you': '#fda4af' });
    // Default: the tokens' own.
    const plain = lookVars({}, false);
    for (const k of ['--c-tool', '--tag', '--c-write', '--user']) expect(plain[k]).toBeUndefined();
    // An accent by hand over Default: those that follow it, not the others.
    const own = lookVars({ accent: '#2563eb' }, true);
    expect(own).toMatchObject({ '--tag': '#2563eb', '--c-tool': undefined });
    expect(own['--user']).not.toBe('#2563eb');
  });
});

describe('fonts', () => {
  it('a list choice, a name before it, everywhere or only in messages', () => {
    expect(fontVars({})).toEqual({ '--font-ui': undefined, '--font-code': undefined, '--font-msg': undefined, '--font-msg-code': undefined });
    expect(fontVars({ fontText: 'serif' })['--font-ui']).toMatch(/^ui-serif/);
    expect(fontVars({ fontTextName: 'Avenir' })['--font-ui']).toBe('"Avenir", system-ui, -apple-system, sans-serif');
    expect(fontVars({ fontCode: 'courier', fontCodeName: 'Fira Code' })['--font-code']).toBe('"Fira Code", "Courier New", Courier, monospace');
    expect(fontVars({ fontText: 'serif', fontScope: 'messages' })).toMatchObject({ '--font-ui': undefined, '--font-msg': expect.stringMatching(/^ui-serif/) });
    // A name that could end the CSS value is not used.
    expect(fontNameOk('Avenir Next')).toBe(true);
    expect(fontNameOk('x"; color: red')).toBe(false);
    expect(fontVars({ fontTextName: 'x"; }' })['--font-ui']).toBeUndefined();
    // They go with the look's other variables, so that another look takes them off.
    expect(lookVars({ fontText: 'mono' }, false)['--font-ui']).toMatch(/^ui-monospace/);
  });

  it('a built-in theme leaves them; a saved one keeps and sets them all', () => {
    const look = { fontText: 'serif' as const, fontCodeName: 'Fira Code' };
    expect(lookWithTheme(look, preset('Ocean'))).toMatchObject(look);
    const mine = themeFromLook('Mine', { ...look, accent: '#123456', strong: '#654321' });
    expect(mine).toMatchObject({ fontText: 'serif', fontCodeName: 'Fira Code', strong: '#654321' });
    const after = lookWithTheme({ fontCode: 'menlo' }, mine);
    expect(after).toMatchObject({ fontText: 'serif', fontCodeName: 'Fira Code', fontCode: undefined, strong: '#654321' });
    expect(isThemeOf(after, mine)).toBe(true);
    expect(isThemeOf({ ...after, fontText: 'rounded' }, mine)).toBe(false);
  });

  it('go in a theme file, invalid ones left out saying why', () => {
    const mine = themeFromLook('Mine', { fontText: 'humanist', fontScope: 'messages', em: '#aa00aa' });
    expect(parseThemes(exportTheme(mine)).themes[0]).toEqual(mine);
    const { themes, skipped } = parseThemes(file({ name: 'Odd', fontText: 'comic', fontCodeName: 'a{b}', strong: 'red' }));
    expect(themes[0]).toEqual({ name: 'Odd' });
    expect(skipped).toEqual([
      expect.stringContaining('strong: "red"'),
      expect.stringContaining('fontText: "comic"'),
      expect.stringContaining('fontCodeName: "a{b}"'),
    ]);
  });
});
