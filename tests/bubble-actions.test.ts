// @vitest-environment jsdom
// The bubble's actions (Settings → Bubble → Actions): their look read from the settings (the defaults
// for what is absent or unknown), where they unfold (an arc away from the nearest edges, a ring when it
// fits), the attributes set on the menu, and the look carried by themes.
import { describe, expect, it } from 'vitest';
import { ACTIONS_GAP, fanOut, RING_MAX, type Fan } from '../src/widget/actions-fan';
import { actionsLook, placeActions, setActionsLook } from '../src/widget/actions-look';
import { parseThemes } from '../src/ui/themes/theme-file';
import { lookWithTheme, themeFromLook } from '../src/ui/themes/theme-model';
import type { Appearance } from '../src/storage/settings-types';

const DEFAULTS = { shape: 'square', layout: 'column', labels: 'icon', size: 'large', px: 44 };

describe('the actions look', () => {
  it('is square, in a column, icons, large, when nothing is set', () => {
    expect(actionsLook(undefined)).toEqual(DEFAULTS);
    expect(actionsLook({})).toEqual(DEFAULTS);
  });
  it('reads unknown values (a newer build’s) as the defaults', () => {
    const odd = { actionsShape: 'hexagon', actionsLayout: 'spiral', actionsLabels: 'emoji', actionsSize: 'huge' } as unknown as Appearance;
    expect(actionsLook(odd)).toEqual(DEFAULTS);
  });
  it('takes what is chosen, sizes in px', () => {
    expect(actionsLook({ actionsShape: 'circle', actionsLayout: 'row', actionsSize: 'small' })).toEqual({ shape: 'circle', layout: 'row', labels: 'icon', size: 'small', px: 28 });
    expect(actionsLook({ actionsSize: 'medium' }).px).toBe(36);
  });
  it('shows names only in a column', () => {
    expect(actionsLook({ actionsLabels: 'name' }).labels).toBe('name');
    for (const layout of ['row', 'arc', 'ring'] as const) expect(actionsLook({ actionsLabels: 'name', actionsLayout: layout }).labels).toBe('icon');
  });
});

describe('where the actions unfold', () => {
  const window = { width: 1000, height: 800, bubble: 44, size: 44 };
  const at = (x: number, y: number, count = 3, more: Partial<Fan> = {}) => fanOut({ ...window, x, y, count, ...more });
  const sign = (n: number) => Math.sign(Math.round(n));

  it('opens an arc away from the nearest edges, in each corner', () => {
    const corners = [
      [20, 20, false, false], // top left: down and right
      [936, 20, false, true], // top right: down and left
      [20, 736, true, false], // bottom left: up and right
      [936, 736, true, true], // bottom right: up and left
    ] as const;
    for (const [x, y, up, left] of corners) {
      const fan = at(x, y);
      expect(fan).toMatchObject({ up, left, ring: false });
      for (const { dx, dy } of fan.at) {
        expect(sign(dx)).not.toBe(left ? 1 : -1);
        expect(sign(dy)).not.toBe(up ? 1 : -1);
      }
      // A quarter circle: the first toward the top or bottom, the last toward the side.
      expect(fan.at[0]!.dx).toBe(0);
      expect(fan.at.at(-1)!.dy).toBe(0);
    }
  });

  it('keeps the buttons of an arc apart, and off the bubble', () => {
    const fan = at(936, 736, 7);
    const least = 44 + ACTIONS_GAP - 0.2; // rounded to tenths
    fan.at.forEach((p, i) => {
      expect(Math.hypot(p.dx, p.dy)).toBeGreaterThanOrEqual(22 + ACTIONS_GAP + 22 - 0.1);
      if (i) expect(Math.hypot(p.dx - fan.at[i - 1]!.dx, p.dy - fan.at[i - 1]!.dy)).toBeGreaterThanOrEqual(least);
    });
  });

  it('puts one button at 45 degrees', () => {
    const [p] = at(20, 20, 1).at;
    expect(p!.dx).toBeGreaterThan(0);
    expect(p!.dx).toBeCloseTo(p!.dy, 0);
  });

  it('makes a ring around the bubble when it fits, the first at the top', () => {
    const fan = at(478, 378, 4, { ring: true });
    expect(fan.ring).toBe(true);
    expect(fan.at[0]).toEqual({ dx: 0, dy: -52 });
    expect(fan.at[1]).toEqual({ dx: 52, dy: 0 }); // clockwise
    const r = fan.at.map((p) => Math.round(Math.hypot(p.dx, p.dy)));
    expect(new Set(r).size).toBe(1);
  });

  it('falls back to an arc with more than RING_MAX buttons', () => {
    expect(at(478, 378, RING_MAX, { ring: true }).ring).toBe(true);
    expect(at(478, 378, RING_MAX + 1, { ring: true })).toMatchObject({ ring: false, up: false, left: false });
  });

  it('falls back to an arc without room for the ring', () => {
    expect(at(936, 736, 4, { ring: true })).toMatchObject({ ring: false, up: true, left: true });
    expect(at(478, 10, 4, { ring: true }).ring).toBe(false);
  });
});

describe('the menu', () => {
  const menuOf = (count: number) => {
    const menu = document.createElement('div');
    for (let i = 0; i < count; i++) menu.append(document.createElement('button'));
    return menu;
  };
  const view = { width: 1000, height: 800 };

  it('carries the look as data attributes, the defaults when nothing is set', () => {
    const menu = menuOf(2);
    setActionsLook(menu, actionsLook(undefined));
    expect({ ...menu.dataset }).toEqual({ shape: 'square', layout: 'column', labels: 'icon', size: 'large' });
    setActionsLook(menu, actionsLook({ actionsShape: 'rounded', actionsLayout: 'ring', actionsLabels: 'name', actionsSize: 'small' }));
    expect({ ...menu.dataset }).toEqual({ shape: 'rounded', layout: 'ring', labels: 'icon', size: 'small' });
  });

  it('opens away from the nearest edges, and places each button of an arc, in their order', () => {
    const menu = menuOf(3);
    const arc = actionsLook({ actionsLayout: 'arc' });
    placeActions(menu, arc, { x: 936, y: 736 }, view, 44);
    expect([...menu.classList].sort()).toEqual(['left', 'up']);
    const offsets = [...menu.children].map((b) => [(b as HTMLElement).style.getPropertyValue('--dx'), (b as HTMLElement).style.getPropertyValue('--dy')]);
    const expected = fanOut({ count: 3, size: 44, bubble: 44, x: 936, y: 736, ...view }).at.map((p) => [`${p.dx}px`, `${p.dy}px`]);
    expect(offsets).toEqual(expected);
    // A column again: no offsets left over, and it opens down and right from the top left.
    placeActions(menu, actionsLook({}), { x: 20, y: 20 }, view, 44);
    expect([...menu.classList].sort()).toEqual(['down', 'right']);
    expect((menu.firstElementChild as HTMLElement).style.getPropertyValue('--dx')).toBe('');
  });
});

describe('themes with the actions look', () => {
  const head = { type: 'browser-agent-theme', version: 2 };
  const look = { actionsShape: 'circle', actionsLayout: 'arc', actionsLabels: 'name', actionsSize: 'medium' } as const;
  it('exports and imports it, leaving out what is not valid', () => {
    const theme = themeFromLook('Round', { accent: '#000000', ...look });
    expect(theme).toMatchObject(look);
    expect(parseThemes(JSON.stringify({ ...head, ...theme }))).toEqual({ themes: [theme], skipped: [] });
    const { themes, skipped } = parseThemes(JSON.stringify({ ...head, name: 'Odd', actionsShape: 'blob', actionsSize: 'small' }));
    expect(themes).toEqual([{ name: 'Odd', actionsSize: 'small' }]);
    expect(skipped).toHaveLength(1);
  });
  it('is set by a theme that has a bubble look', () => {
    expect(lookWithTheme(look, { bubbleFace: 'shape' })).toMatchObject({ bubbleFace: 'shape', actionsShape: undefined, actionsLayout: undefined });
    expect(lookWithTheme({}, { actionsLayout: 'ring' })).toMatchObject({ actionsLayout: 'ring' });
  });
});
