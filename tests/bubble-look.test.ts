// @vitest-environment jsdom
// The page widget's bubble (Settings → Bubble): its look read from the settings, its face drawn, the
// user's SVG made safe, where the eyes look, and the look carried by themes.
import { describe, expect, it } from 'vitest';
import { BUBBLE_EYES, BUBBLE_HATS, BUBBLE_MOUTHS, BUBBLE_SHAPES, bubbleLook, lookOffset, shapeTree } from '../src/widget/bubble-look';
import { bubbleFace, svgFromTree } from '../src/widget/bubble-face';
import { MAX_SVG, safeSvg, safeSvgElement } from '../src/widget/svg-safe';
import { parseThemes } from '../src/ui/themes/theme-file';
import { isThemeOf, lookWithTheme, themeFromLook } from '../src/ui/themes/theme-model';

const clean = (markup: string) => {
  const check = safeSvg(markup);
  if ('error' in check) throw new Error(check.error);
  return check;
};

describe('the bubble look', () => {
  it('is the icon unless a shape or an SVG is chosen', () => {
    expect(bubbleLook(undefined).face).toBe('icon');
    expect(bubbleLook({ bubbleFace: 'shape' }).face).toBe('shape');
    // An SVG chosen but none kept: the icon.
    expect(bubbleLook({ bubbleFace: 'svg' }).face).toBe('icon');
    expect(bubbleLook({ bubbleFace: 'svg', bubbleSvg: '<svg/>' }).face).toBe('svg');
  });
  it('shows what it does not know (a newer build\'s) as the defaults', () => {
    const look = bubbleLook({ bubbleFace: 'shape', bubbleShape: 'unicorn', bubbleEyes: 'laser', bubbleHat: 'toString', bubbleThinking: 'dance' as never });
    expect(look).toMatchObject({ shape: 'orb', eyes: undefined, hat: undefined, thinking: 'ring' });
  });
  it('has a face only on shapes with one', () => {
    const face = { bubbleFace: 'shape', bubbleEyes: 'round', bubbleMouth: 'smile', bubbleHat: 'crown', bubbleCheeks: true, bubbleEyesFollow: true } as const;
    expect(bubbleLook({ ...face, bubbleShape: 'ghost' })).toMatchObject({ eyes: 'round', mouth: 'smile', hat: 'crown', cheeks: true, follows: true });
    expect(bubbleLook({ ...face, bubbleShape: 'dots' })).toMatchObject({ eyes: undefined, mouth: undefined, hat: undefined, cheeks: false, follows: false, thinking: 'own' });
    // Not on the icon, whatever was left set.
    expect(bubbleLook({ ...face, bubbleFace: undefined })).toMatchObject({ eyes: undefined, follows: false });
  });
  it('follows the pointer only with eyes that move', () => {
    expect(bubbleLook({ bubbleFace: 'shape', bubbleEyes: 'happy', bubbleEyesFollow: true }).follows).toBe(false);
    expect(bubbleLook({ bubbleFace: 'shape', bubbleEyes: 'big' }).follows).toBe(false);
  });
  it('thinks with its face only when it has eyes', () => {
    expect(bubbleLook({ bubbleFace: 'shape', bubbleEyes: 'round', bubbleThinking: 'face' }).thinking).toBe('face');
    expect(bubbleLook({ bubbleFace: 'shape', bubbleThinking: 'face' }).thinking).toBe('ring');
    expect(bubbleLook({ bubbleThinking: 'pulse' }).thinking).toBe('pulse');
  });
});

describe('the bubble face', () => {
  it('draws every shape, eyes, mouth and hat', () => {
    for (const shape of Object.keys(BUBBLE_SHAPES)) {
      for (const eyes of Object.keys(BUBBLE_EYES)) {
        const look = bubbleLook({ bubbleFace: 'shape', bubbleShape: shape, bubbleEyes: eyes, bubbleMouth: Object.keys(BUBBLE_MOUTHS)[0], bubbleHat: 'wizard-hat' });
        const svg = svgFromTree(shapeTree(look).svg);
        expect(svg.querySelectorAll('.body').length).toBeGreaterThan(0);
        expect(svg.innerHTML).not.toMatch(/NaN|undefined/);
      }
    }
    for (const mouth of Object.keys(BUBBLE_MOUTHS)) expect(svgFromTree(shapeTree(bubbleLook({ bubbleFace: 'shape', bubbleMouth: mouth })).svg).innerHTML).not.toMatch(/NaN|undefined/);
  });
  it('says how far a hat rises above the bubble', () => {
    const tree = (hat?: string) => shapeTree(bubbleLook({ bubbleFace: 'shape', bubbleShape: 'orb', bubbleHat: hat }));
    expect(tree().overhang).toBe(0);
    expect(tree('wizard-hat').overhang).toBe(20); // its tip 21 px over the orb's top, which is 1 px down
    expect(tree('bow').overhang).toBe(0);
    for (const hat of Object.keys(BUBBLE_HATS)) expect(tree(hat).overhang).toBeLessThanOrEqual(24);
  });
  it('has a mouth for each state of the floating chat', () => {
    const svg = svgFromTree(shapeTree(bubbleLook({ bubbleFace: 'shape', bubbleEyes: 'round', bubbleMouth: 'smile' })).svg);
    expect([...svg.querySelectorAll('.mouth')].map((m) => m.getAttribute('class'))).toEqual(['mouth rest', 'mouth think', 'mouth wait', 'mouth done']);
  });
  it('is the icon, or ✦, or the user\'s SVG made safe', () => {
    expect(bubbleFace(undefined).nodes).toEqual(['✦']);
    expect((bubbleFace({ bubbleIcon: 'cat' }).nodes[0] as Element).tagName).toBe('svg');
    const own = bubbleFace({ bubbleFace: 'svg', bubbleSvg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="4" onclick="x()"/></svg>' }).nodes[0] as Element;
    expect(own.getAttribute('class')).toBe('own');
    expect(own.querySelector('circle')?.hasAttribute('onclick')).toBe(false);
    expect(bubbleFace({ bubbleThinking: 'thought' }).nodes[1]).toHaveProperty('className', 'thought');
  });
});

describe('the user\'s SVG', () => {
  const svg = (inner: string, attrs = '') => `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"${attrs}>${inner}</svg>`;
  it('keeps the drawing', () => {
    const { svg: out, removed } = clean(svg('<g transform="translate(1 1)"><path d="M0 0L10 10" stroke="currentColor"/></g><circle cx="5" cy="5" r="2" fill="url(#g)"/><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs>'));
    expect(removed).toEqual([]);
    expect(out).toContain('<path d="M0 0L10 10" stroke="currentColor"/>');
    expect(out).toContain('fill="url(#g)"');
  });
  it('removes scripts, handlers, links, styles, images, animations and outside references', () => {
    const { svg: out, removed } = clean(svg(
      '<script>alert(1)</script><script>2</script><path d="M0 0" onload="x()" onclick="y()"/><a href="https://example.com"><rect width="1" height="1"/></a>' +
      '<image href="https://example.com/x.png"/><foreignObject><div>x</div></foreignObject><style>@import url(https://example.com/a.css)</style>' +
      '<circle r="3" style="fill:url(https://example.com/x)" class="c"/><rect width="2" height="2" fill="url(https://example.com/f)"/>' +
      '<use href="#a"/><animate attributeName="href" to="javascript:alert(1)"/><set attributeName="onclick"/><path d="M1 1" xlink:href="javascript:x"/>' +
      '<rect width="1" height="1" fill="javascript:alert(1)"/>',
      ' onload="z()"',
    ));
    expect(removed).toEqual(expect.arrayContaining(['<script> ×2', 'event handlers ×3', '<a>', '<image>', '<foreignObject>', '<style>', 'styles ×2', 'external references', '<use>', '<animate>', '<set>', 'links', 'the attribute fill']));
    expect(out).not.toMatch(/script|onload|onclick|href|https|style|foreignObject|animate|javascript/i);
  });
  it('refuses what is not an SVG, too large, or has nothing left to draw', () => {
    expect(safeSvg('<html><body/></html>')).toEqual({ error: 'This is not an SVG.' });
    expect(safeSvg('not markup')).toEqual({ error: 'This is not an SVG.' });
    expect(safeSvg(svg('<script>1</script>'))).toEqual({ error: 'Nothing drawable was left once the unsafe parts were removed.' });
    const big = svg(`<path d="${'M0 0L1 1'.repeat(MAX_SVG / 8 + 10)}"/>`);
    expect(safeSvg(big)).toEqual({ error: 'It is larger than 16 KB.' });
    expect(safeSvg(svg(`<path d="${'M0 0'.repeat(20000)}"/>`))).toEqual({ error: 'It is larger than 64 KB.' });
  });
  it('gets a viewBox from its size, and is sized by the bubble', () => {
    const { svg: out } = clean('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="32"><rect width="4" height="4"/></svg>');
    expect(out).toContain('viewBox="0 0 48 32"');
    expect(out).not.toMatch(/width="48"/);
  });
  it('is made safe again when the widget draws it', () => {
    const el = safeSvgElement(svg('<rect width="1" height="1" onclick="x()"/>'))!;
    expect(el.querySelector('rect')?.hasAttribute('onclick')).toBe(false);
    expect(safeSvgElement('<p>no</p>')).toBeUndefined();
  });
});

describe('where the eyes look', () => {
  it('points toward the pointer, all the way once it is far', () => {
    expect(lookOffset(0, 0)).toEqual({ x: 0, y: 0 });
    expect(lookOffset(240, 0)).toEqual({ x: 1, y: 0 });
    expect(lookOffset(0, -60)).toEqual({ x: 0, y: -0.5 });
    const { x, y } = lookOffset(300, 400);
    expect(Math.hypot(x, y)).toBeCloseTo(1);
  });
});

describe('themes with a bubble look', () => {
  const head = { type: 'browser-agent-theme', version: 2 };
  const ghost = { bubbleFace: 'shape', bubbleShape: 'ghost', bubbleEyes: 'round', bubbleEyesFollow: true, bubbleHat: 'party-hat', bubbleColor: '#0f6e56', bubbleThinking: 'thought' } as const;
  it('exports and imports it', () => {
    const theme = themeFromLook('Spooky', { accent: '#000000', ...ghost });
    expect(theme).toMatchObject(ghost);
    expect(parseThemes(JSON.stringify({ ...head, ...theme }))).toEqual({ themes: [theme], skipped: [] });
  });
  it('leaves out what is not valid, saying why, and makes its SVG safe again', () => {
    const { themes, skipped } = parseThemes(JSON.stringify({
      ...head, name: 'Odd', bubbleFace: 'video', bubbleShape: 'blob', bubbleHat: 'toString', bubbleCheeks: 'yes', bubbleColor: 'red', bubbleSvgUrl: 'javascript:x',
      bubbleSvg: '<svg xmlns="http://www.w3.org/2000/svg"><script>1</script><circle r="2"/></svg>',
    }));
    expect(themes).toEqual([{ name: 'Odd', bubbleShape: 'blob', bubbleSvg: '<svg xmlns="http://www.w3.org/2000/svg"><circle r="2"/></svg>' }]);
    expect(skipped).toHaveLength(6);
    expect(skipped.join('\n')).toMatch(/"Odd" from its bubble SVG: <script>/);
  });
  it('sets all of the bubble look when it has any, and none of it otherwise', () => {
    const look = { bubbleIcon: 'cat', bubbleFace: 'svg', bubbleSvg: '<svg/>', bubbleSvgBare: true } as const;
    const chosen = lookWithTheme(look, { bubbleFace: 'shape', bubbleShape: 'star' });
    expect(chosen).toMatchObject({ bubbleFace: 'shape', bubbleShape: 'star', bubbleIcon: undefined, bubbleSvg: undefined, bubbleSvgBare: undefined });
    expect(isThemeOf(chosen, { bubbleFace: 'shape', bubbleShape: 'star' })).toBe(true);
    expect(isThemeOf({ ...chosen, bubbleHat: 'cap' }, { bubbleFace: 'shape', bubbleShape: 'star' })).toBe(false);
    expect(lookWithTheme(look, { accent: '#123456' })).toMatchObject(look);
  });
});
