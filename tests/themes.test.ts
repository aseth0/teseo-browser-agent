import { describe, expect, it } from 'vitest';
import { exportTheme, exportThemes, importedThemes, importThemes, parseThemes } from '../src/ui/themes/theme-file';
import { deleteTheme, isThemeOf, lookName, lookWithTheme, MAX_THEMES, saveTheme, themeFromLook, themeNameProblem } from '../src/ui/themes/theme-model';
import type { CustomTheme } from '../src/storage/settings-types';

const head = { type: 'browser-agent-theme', version: 2 };
const dusk: CustomTheme = { name: 'Dusk', mode: 'dark', accent: '#7c3aed', highlights: { message: '#60a5fa', page: '#fde047' }, bubbleIcon: 'moon' };
const json = (v: unknown) => JSON.stringify(v);

describe('theme files', () => {
  it('reads one theme', () => {
    const { themes, skipped } = parseThemes(json({ ...head, ...dusk }));
    expect(skipped).toEqual([]);
    expect(themes).toEqual([dusk]);
  });
  it('reads a list of themes', () => {
    const { themes, skipped } = parseThemes(json({ ...head, themes: [dusk, { name: 'Plain' }] }));
    expect(skipped).toEqual([]);
    expect(themes.map((t) => t.name)).toEqual(['Dusk', 'Plain']);
  });
  it('refuses another type or version, and what is not JSON', () => {
    expect(() => parseThemes(json({ ...dusk, type: 'other', version: 1 }))).toThrow('Not a theme file');
    expect(() => parseThemes(json({ ...dusk, version: 1 }))).toThrow('Not a theme file');
    expect(() => parseThemes(json({ ...head, ...dusk, version: 3 }))).toThrow('only version 1 or 2');
    expect(() => parseThemes(json([dusk]))).toThrow('Not a theme file');
    expect(() => parseThemes('{nope')).toThrow();
    // A theme of a list with its own other type is left out.
    expect(parseThemes(json({ ...head, themes: [{ ...dusk, version: 3 }] })).skipped).toHaveLength(1);
  });
  it('leaves out colors that are not #rrggbb, saying why', () => {
    const { themes, skipped } = parseThemes(json({ ...head, name: 'Odd', accent: 'blue', highlights: { message: '#12345', page: '#ABCDEF' } }));
    expect(themes).toEqual([{ name: 'Odd', highlights: { page: '#abcdef' } }]);
    expect(skipped).toEqual(['"Odd" accent: "blue" is not a #rrggbb color', '"Odd" highlight "message": "#12345" is not a #rrggbb color']);
  });
  it('leaves out unknown origins, modes, bubble icons and fields', () => {
    const { themes, skipped } = parseThemes(json({ ...head, name: 'Odd', mode: 'sepia', bubbleIcon: 'unicorn', highlights: { nowhere: '#000000', tool: '#111111' }, font: 'x' }));
    expect(themes).toEqual([{ name: 'Odd', highlights: { tool: '#111111' } }]);
    expect(skipped).toHaveLength(4);
    expect(skipped.join('\n')).toMatch(/"nowhere": not a Layers origin/);
    expect(skipped.join('\n')).toMatch(/"font": not a theme field/);
    expect(parseThemes(json({ ...head, name: 'Proto', bubbleIcon: 'toString' })).themes).toEqual([{ name: 'Proto' }]);
    expect(parseThemes(json({ ...head, name: 'Proto2', highlights: { toString: '#000000', constructor: '#000000' } })).themes).toEqual([{ name: 'Proto2' }]);
  });
  it('leaves out themes without a valid name', () => {
    const { themes, skipped } = parseThemes(json({ ...head, themes: [{ name: 'x'.repeat(61) }, { name: '  ' }, { name: 'ocean' }, 3, dusk, { ...dusk, accent: '#000000' }] }));
    expect(themes).toEqual([dusk]);
    expect(skipped).toHaveLength(5);
    expect(skipped[0]).toMatch(/longer than 60/);
    expect(skipped[2]).toMatch(/built-in theme/);
    expect(skipped[4]).toMatch(/a second time/);
    expect(parseThemes(json({ ...head, name: 'x'.repeat(60) })).themes).toHaveLength(1);
  });
  it('refuses too many themes and too large a file', () => {
    const many = Array.from({ length: MAX_THEMES + 1 }, (_, i) => ({ name: `T${i}` }));
    expect(() => parseThemes(json({ ...head, themes: many }))).toThrow('Too many themes: 51');
    expect(parseThemes(json({ ...head, themes: many.slice(1) })).themes).toHaveLength(MAX_THEMES);
    expect(() => parseThemes(json({ ...head, name: 'Big', pad: 'x'.repeat(100 * 1024) }))).toThrow('Too large');
  });
  it('exports what imports again, one theme or all of them', () => {
    expect(parseThemes(exportTheme(dusk))).toEqual({ themes: [dusk], skipped: [] });
    const all = [dusk, { name: 'Plain' }, { name: 'Sea', accent: '#0284c7' }];
    expect(parseThemes(exportThemes(all))).toEqual({ themes: all, skipped: [] });
    expect(JSON.parse(exportTheme(dusk))).toMatchObject(head);
  });
  it('exports the current appearance under the saved theme it is, else "My theme"', () => {
    const look = { mode: 'dark' as const, accent: '#7c3aed', highlights: { message: '#60a5fa', page: '#fde047' }, bubbleIcon: 'moon' };
    expect(lookName(look, [dusk])).toBe('Dusk');
    expect(lookName({ ...look, accent: '#000000' }, [dusk])).toBe('My theme');
    expect(themeFromLook(' Mine ', { accent: '#000000', highlights: {} })).toEqual({ name: 'Mine', accent: '#000000' });
  });
});

describe('saved themes', () => {
  it('saves, replaces the one of the same name in place, deletes', () => {
    let list = saveTheme([], dusk);
    list = saveTheme(list, { name: 'Sea', accent: '#0284c7' });
    list = saveTheme(list, { name: 'dusk ', accent: '#000000' });
    expect(list).toEqual([{ name: 'dusk', accent: '#000000' }, { name: 'Sea', accent: '#0284c7' }]);
    expect(deleteTheme(list, 'DUSK')).toEqual([{ name: 'Sea', accent: '#0284c7' }]);
  });
  it('never takes a built-in theme\'s name, an empty or too long one', () => {
    expect(themeNameProblem('High Contrast')).toMatch(/built-in/);
    expect(() => saveTheme([], { name: 'Default' })).toThrow(/built-in/);
    expect(themeNameProblem(' ')).toMatch(/name/);
    expect(themeNameProblem('x'.repeat(61))).toMatch(/60/);
    expect(themeNameProblem('Mine')).toBeUndefined();
  });
  it('keeps at most 50', () => {
    const full = Array.from({ length: MAX_THEMES }, (_, i) => ({ name: `T${i}` }));
    expect(() => saveTheme(full, { name: 'More' })).toThrow(/At most 50/);
    expect(saveTheme(full, { name: 't3', accent: '#000000' })[3]).toEqual({ name: 't3', accent: '#000000' });
    const { themes, names, skipped } = importThemes(full, { themes: [{ name: 'More' }, { name: 'T0', accent: '#111111' }], skipped: [] });
    expect(names).toEqual(['"T0"']);
    expect(themes[0]).toEqual({ name: 'T0', accent: '#111111' });
    expect(skipped).toEqual(['"More": at most 50 saved themes']);
  });
  it('imports into the list without applying, and says so', () => {
    const { themes, names, skipped } = importThemes([{ name: 'Dusk' }], parseThemes(exportThemes([dusk, { name: 'Sea' }])));
    expect(themes).toEqual([dusk, { name: 'Sea' }]);
    expect(importedThemes(names, skipped)).toEqual({ said: 'Imported "Dusk", "Sea": pick one in Theme to use it.', all: true });
    expect(importedThemes(['"Sea"'], ['"X" accent: bad'])).toEqual({ said: 'Imported "Sea": pick it in Theme to use it.\nLeft out "X" accent: bad.', all: false });
  });
  it('choosing one sets its colors, and its mode and bubble icon when it has them', () => {
    const look = { mode: 'light' as const, accent: '#111111', highlights: { tool: '#222222' }, bubbleIcon: 'cat' };
    expect(lookWithTheme(look, dusk)).toEqual({ mode: 'dark', accent: '#7c3aed', highlights: dusk.highlights, bubbleIcon: 'moon' });
    expect(lookWithTheme(look, {})).toEqual({ mode: 'light', accent: undefined, highlights: undefined, bubbleIcon: 'cat' });
    expect(isThemeOf(lookWithTheme(look, dusk), dusk)).toBe(true);
    expect(isThemeOf({ ...lookWithTheme(look, dusk), mode: 'light' }, dusk)).toBe(false);
    expect(isThemeOf({}, {})).toBe(true);
  });
});
