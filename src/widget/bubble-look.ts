// The page widget's bubble as Settings → Bubble draws it: a Lucide icon (widget/bubble-icons), a shape
// with a face (eyes, mouth, hat, cheeks), or the user's own SVG (widget/svg-safe). Plain data: SVG
// as trees of [tag, attributes, children], drawn by the widget (widget/bubble-face) and by Settings
// (its shape picker). Every shape is drawn on a 44 × 44 grid, the bubble's size in px; a hat may rise
// above it.
import type { Appearance } from '../storage/settings-types';

export type SvgNode = [tag: string, attrs: Record<string, string | number>, children?: SvgNode[]];

interface Shape {
  label: string;
  body: SvgNode[];
  face?: { eyes: number; mouth: number; top: number }; // where the eyes and the mouth are, and where a hat sits
  idle?: 'breathe' | 'bob' | 'squish'; // how it moves at rest
}

const body = (tag: string, attrs: Record<string, string | number>): SvgNode => [tag, { class: 'body', ...attrs }];
// Polygons with rounded corners: their outline, in their color, rounds them.
const rounded = (points: string, width: number): SvgNode => body('polygon', { points, class: 'body rounded', 'stroke-width': width });

export const BUBBLE_SHAPES: Record<string, Shape> = {
  orb: { label: 'Orb', body: [body('circle', { cx: 22, cy: 22, r: 21 })], face: { eyes: 19, mouth: 29, top: 1 }, idle: 'breathe' },
  // Its outline changes slowly (style.ts, ba-blob).
  blob: { label: 'Blob', body: [body('path', { class: 'body blob', d: 'M22 2C33 2 42 9 42 21S34 42 21 42 2 33 2 22 11 2 22 2Z' })], face: { eyes: 19, mouth: 29, top: 2 } },
  squircle: { label: 'Rounded square', body: [body('rect', { x: 2, y: 2, width: 40, height: 40, rx: 13 })], face: { eyes: 19, mouth: 29, top: 2 } },
  pill: { label: 'Pill', body: [body('rect', { x: 1, y: 9, width: 42, height: 26, rx: 13 })], face: { eyes: 19, mouth: 28, top: 9 } },
  drop: { label: 'Drop', body: [body('path', { d: 'M22 2C22 2 7 19 7 28a15 15 0 0 0 30 0C37 19 22 2 22 2Z' })], face: { eyes: 27, mouth: 35, top: 9 } },
  hexagon: { label: 'Hexagon', body: [rounded('22,3 39,12.5 39,31.5 22,41 5,31.5 5,12.5', 4)], face: { eyes: 19, mouth: 29, top: 3 } },
  diamond: { label: 'Diamond', body: [rounded('22,3 41,22 22,41 3,22', 4)], face: { eyes: 20, mouth: 29, top: 6 } },
  star: { label: 'Star', body: [rounded('22,2 27.9,14.9 42,16.5 31.5,26.1 34.3,40 22,33 9.7,40 12.5,26.1 2,16.5 16.1,14.9', 3)], face: { eyes: 21, mouth: 28, top: 6 } },
  heart: { label: 'Heart', body: [body('path', { d: 'M22 40C10 31 2 24 2 15a10 10 0 0 1 20-4 10 10 0 0 1 20 4c0 9-8 16-20 25Z' })], face: { eyes: 17, mouth: 26, top: 6 } },
  cloud: { label: 'Cloud', body: [body('path', { d: 'M11 36a9 9 0 0 1-1.5-17.9A12.5 12.5 0 0 1 33 15.5 10.3 10.3 0 0 1 33 36Z' })], face: { eyes: 23, mouth: 30, top: 7 } },
  ghost: { label: 'Ghost', body: [body('path', { d: 'M5 41V21a17 17 0 0 1 34 0v20l-5.7-4-5.6 4-5.7-4-5.7 4-5.6-4Z' })], face: { eyes: 19, mouth: 28, top: 4 }, idle: 'bob' },
  cat: { label: 'Cat', body: [body('path', { d: 'M3 27c0-8 2-13 3.5-16L5 2l10 6q7-2 14 0l10-6-1.5 9C39 14 41 19 41 27c0 9-8 15-19 15S3 36 3 27Z' })], face: { eyes: 24, mouth: 33, top: 8 } },
  speech: { label: 'Speech bubble', body: [body('path', { d: 'M9 3h26q7 0 7 7v17q0 7-7 7H19l-10 8 2-8H9q-7 0-7-7V10q0-7 7-7Z' })], face: { eyes: 15, mouth: 24, top: 3 } },
  mochi: { label: 'Mochi', body: [body('path', { d: 'M2 40C2 21 10 10 22 10S42 21 42 40Z' })], face: { eyes: 27, mouth: 34, top: 10 }, idle: 'squish' },
  // No face: while the agent works they wave (style.ts).
  dots: { label: 'Dots', body: [10, 22, 34].map((cx) => body('circle', { class: 'body dot', cx, cy: 22, r: 5.5 })) },
  bars: { label: 'Bars', body: [7.5, 15.5, 23.5, 31.5].map((x) => body('rect', { class: 'body bar', x, y: 11, width: 5, height: 22, rx: 2.5 })) },
};

const SCLERA = '#fff';
const PUPIL = '#26215c';
const PINK = '#ff7aa8';
const ink = (attrs: Record<string, string | number>): SvgNode[1] => ({ class: 'ink', fill: 'none', 'stroke-linecap': 'round', ...attrs });
const pupil = (cx: number, cy: number, r: number): SvgNode => ['g', { class: 'pupil' }, [['circle', { cx, cy, r, fill: PUPIL }]]];
const eye = (...children: SvgNode[]): SvgNode => ['g', { class: 'eye' }, children];

interface Eyes {
  label: string;
  draw: (x: number, y: number, side: -1 | 1) => SvgNode;
  moves?: boolean; // the pupils follow the pointer, and the eyes blink
  one?: boolean; // one eye, in the middle
}

export const BUBBLE_EYES: Record<string, Eyes> = {
  round: { label: 'Round', moves: true, draw: (x, y) => eye(['ellipse', { cx: x, cy: y, rx: 4.5, ry: 5.5, fill: SCLERA }], pupil(x, y, 2.3)) },
  dots: { label: 'Dots', moves: true, draw: (x, y) => eye(['g', { class: 'pupil' }, [['circle', { class: 'ink-fill', cx: x, cy: y, r: 2.6 }]]]) },
  big: { label: 'Big', moves: true, draw: (x, y) => eye(['circle', { cx: x, cy: y, r: 6.3, fill: SCLERA }], pupil(x, y, 2.8)) },
  sleepy: {
    label: 'Sleepy', moves: true,
    draw: (x, y) => eye(['path', { d: `M${x - 4.5} ${y}A4.5 5 0 0 0 ${x + 4.5} ${y}Z`, fill: SCLERA }], pupil(x, y + 2, 1.9), ['path', { d: `M${x - 5} ${y}H${x + 5}`, stroke: PUPIL, 'stroke-width': 1.4, 'stroke-linecap': 'round' }]),
  },
  angry: {
    label: 'Angry', moves: true,
    draw: (x, y, side) => ['g', {}, [
      eye(['ellipse', { cx: x, cy: y, rx: 4.5, ry: 5.5, fill: SCLERA }], pupil(x, y, 2.3)),
      ['path', ink({ d: `M${x - 5} ${y - 7 - 2 * side}L${x + 5} ${y - 7 + 2 * side}`, 'stroke-width': 2 })],
    ]],
  },
  cyclops: { label: 'Cyclops', moves: true, one: true, draw: (x, y) => eye(['circle', { cx: x, cy: y, r: 7, fill: SCLERA }], pupil(x, y, 3.2)) },
  happy: { label: 'Happy', draw: (x, y) => ['path', ink({ d: `M${x - 4} ${y + 1.5}Q${x} ${y - 5} ${x + 4} ${y + 1.5}`, 'stroke-width': 2.2 })] },
  hearts: { label: 'Hearts', draw: (x, y) => ['path', { d: `M${x} ${y + 4}c-3-2-4.5-3.5-4.5-5.5a2.3 2.3 0 0 1 4.5-.8 2.3 2.3 0 0 1 4.5.8c0 2-1.5 3.5-4.5 5.5Z`, fill: PINK }] },
  stars: { label: 'Stars', draw: (x, y) => ['path', { d: `M${x} ${y - 5}L${x + 1.4} ${y - 1.4}L${x + 5} ${y}L${x + 1.4} ${y + 1.4}L${x} ${y + 5}L${x - 1.4} ${y + 1.4}L${x - 5} ${y}L${x - 1.4} ${y - 1.4}Z`, fill: '#fde68a' }] },
};

const smile = (y: number): SvgNode => ['path', ink({ d: `M17 ${y}Q22 ${y + 4.5} 27 ${y}`, 'stroke-width': 2 })];
const openMouth = (y: number): SvgNode => ['ellipse', { class: 'ink', cx: 22, cy: y + 1, rx: 2.5, ry: 3.2, fill: PUPIL, 'stroke-width': 1 }];
const flat = (y: number): SvgNode => ['path', ink({ d: `M18 ${y + 1}H26`, 'stroke-width': 2 })];
const grin = (y: number): SvgNode => ['path', { class: 'ink', d: `M16.5 ${y - 1}Q22 ${y + 8} 27.5 ${y - 1}Z`, fill: PUPIL, 'stroke-width': 1, 'stroke-linejoin': 'round' }];

export const BUBBLE_MOUTHS: Record<string, { label: string; draw: (y: number) => SvgNode[] }> = {
  smile: { label: 'Smile', draw: (y) => [smile(y)] },
  grin: { label: 'Grin', draw: (y) => [grin(y)] },
  open: { label: 'Open', draw: (y) => [openMouth(y)] },
  flat: { label: 'Flat', draw: (y) => [flat(y)] },
  tongue: { label: 'Tongue', draw: (y) => [smile(y), ['ellipse', { cx: 23.5, cy: y + 3.6, rx: 2, ry: 2.4, fill: PINK }]] },
  cat: { label: 'Cat', draw: (y) => [['path', ink({ d: `M17 ${y}q2.5 3 5 0q2.5 3 5 0`, 'stroke-width': 1.8 })]] },
  fangs: {
    label: 'Fangs',
    draw: (y) => [['path', ink({ d: `M16 ${y}Q22 ${y + 3} 28 ${y}`, 'stroke-width': 1.8 })], ['path', { class: 'ink-fill', d: `M18.5 ${y + 1}l1.2 3 1.2-2.6M23.1 ${y + 1.4}l1.2 2.6 1.2-3` }]],
  },
};

// Hats in their own colors, set on the shape's top (`t`); `top`: their highest point.
const DARK = '#1f1f24';
interface Hat { label: string; draw: (t: number) => SvgNode[]; top: (t: number) => number }
export const BUBBLE_HATS: Record<string, Hat> = {
  'top-hat': {
    label: 'Top hat', top: (t) => t - 15,
    draw: (t) => [['rect', { x: 15, y: t - 15, width: 14, height: 13, rx: 1, fill: DARK }], ['rect', { x: 15, y: t - 6, width: 14, height: 2.6, fill: '#dc2626' }], ['rect', { x: 11, y: t - 3, width: 22, height: 3.2, rx: 1.5, fill: DARK }]],
  },
  'party-hat': {
    label: 'Party hat', top: (t) => t - 19.4,
    draw: (t) => [['polygon', { points: `22,${t - 17} 29,${t + 1} 15,${t + 1}`, fill: '#f59e0b' }], ['path', { d: `M18.6 ${t - 6}L26.4 ${t - 8}M17 ${t - 1}L27.6 ${t - 3.4}`, stroke: '#fff', 'stroke-width': 1.6 }], ['circle', { cx: 22, cy: t - 17, r: 2.4, fill: '#ef4444' }]],
  },
  crown: {
    label: 'Crown', top: (t) => t - 11.5,
    draw: (t) => [['polygon', { points: `13,${t + 1} 13,${t - 9} 17.5,${t - 4} 22,${t - 11} 26.5,${t - 4} 31,${t - 9} 31,${t + 1}`, fill: '#fbbf24', stroke: '#b45309', 'stroke-width': 1, 'stroke-linejoin': 'round' }]],
  },
  'wizard-hat': {
    label: 'Wizard hat', top: (t) => t - 21,
    draw: (t) => [
      ['polygon', { points: `24,${t - 21} 30,${t} 14,${t}`, fill: '#3b3f9e' }],
      ['path', { d: `M21 ${t - 8}l.8 1.8 1.9.2-1.4 1.3.4 1.9-1.7-1-1.7 1 .4-1.9-1.4-1.3 1.9-.2Z`, fill: '#fde68a' }],
      ['ellipse', { cx: 22, cy: t, rx: 12, ry: 2.4, fill: '#2e3180' }],
    ],
  },
  beanie: {
    label: 'Beanie', top: (t) => t - 9.6,
    draw: (t) => [['path', { d: `M13 ${t + 3}A9 9.5 0 0 1 31 ${t + 3}Z`, fill: '#ef4444' }], ['rect', { x: 12, y: t + 1, width: 20, height: 4, rx: 2, fill: '#b91c1c' }], ['circle', { cx: 22, cy: t - 7, r: 2.6, fill: '#fff' }]],
  },
  cap: {
    label: 'Cap', top: (t) => t - 6.5,
    draw: (t) => [['path', { d: `M13 ${t + 2}A9 8.5 0 0 1 31 ${t + 2}Z`, fill: '#2563eb' }], ['ellipse', { cx: 32, cy: t + 2, rx: 7.5, ry: 1.9, fill: '#1d4ed8' }]],
  },
  'cowboy-hat': {
    label: 'Cowboy hat', top: (t) => t - 10.5,
    draw: (t) => [['path', { d: `M16 ${t - 1}Q15 ${t - 12} 22 ${t - 9}Q29 ${t - 12} 28 ${t - 1}Z`, fill: '#a16207' }], ['path', { d: `M8 ${t - 3}Q22 ${t + 5} 36 ${t - 3}Q22 ${t + 1} 8 ${t - 3}Z`, fill: '#854d0e' }]],
  },
  bow: {
    label: 'Bow', top: (t) => t,
    draw: (t) => [['path', { d: `M30 ${t + 4}l-6-4v8Zm0 0l6-4v8Z`, fill: '#ec4899' }], ['circle', { cx: 30, cy: t + 4, r: 1.8, fill: '#be185d' }]],
  },
  // Over the head, whatever the shape: on the sides, where the ears would be.
  headphones: {
    label: 'Headphones', top: () => 3.7,
    draw: () => [['path', { d: 'M5 22A17 17 0 0 1 39 22', stroke: DARK, 'stroke-width': 2.6, fill: 'none' }], ['rect', { x: 1, y: 19, width: 6, height: 11, rx: 3, fill: DARK }], ['rect', { x: 37, y: 19, width: 6, height: 11, rx: 3, fill: DARK }]],
  },
  antenna: {
    label: 'Antenna', top: (t) => t - 12.8,
    draw: (t) => [['path', { d: `M22 ${t + 1}V${t - 9}`, stroke: DARK, 'stroke-width': 1.6 }], ['circle', { cx: 22, cy: t - 10, r: 2.8, fill: '#22c55e' }]],
  },
  halo: { label: 'Halo', top: (t) => t - 9.7, draw: (t) => [['ellipse', { cx: 22, cy: t - 6, rx: 9.5, ry: 2.6, stroke: '#fbbf24', 'stroke-width': 2.2, fill: 'none' }]] },
  horns: {
    label: 'Horns', top: (t) => t - 8,
    draw: (t) => [['path', { d: `M14 ${t + 3}Q11 ${t - 4} 13 ${t - 8}Q15 ${t - 2} 19 ${t + 2}Z`, fill: '#dc2626' }], ['path', { d: `M30 ${t + 3}Q33 ${t - 4} 31 ${t - 8}Q29 ${t - 2} 25 ${t + 2}Z`, fill: '#dc2626' }]],
  },
};

export const BUBBLE_FACES = ['shape', 'svg'] as const; // none: the icon
export const BUBBLE_THINKING = ['pulse', 'thought', 'face', 'none'] as const; // none: the ring
type BubbleThinking = 'ring' | (typeof BUBBLE_THINKING)[number];

const known = <T>(table: Record<string, T>, id: string | undefined) => (id !== undefined && Object.hasOwn(table, id) ? id : undefined);

// How the bubble shows that the folded floating chat works: dots and bars wave themselves; the face
// thinks only with eyes (else the ring).
function thinkingOf(a: Appearance | undefined, faceless: boolean, eyes: string | undefined): BubbleThinking | 'own' {
  if (faceless) return 'own';
  const chosen = BUBBLE_THINKING.find((t) => t === a?.bubbleThinking) ?? 'ring';
  return chosen === 'face' && !eyes ? 'ring' : chosen;
}

// The bubble's look as Settings → Bubble set it, what is unknown (a newer build's) left as the default.
export function bubbleLook(a: Appearance | undefined) {
  const face = a?.bubbleFace === 'svg' && a.bubbleSvg ? 'svg' : a?.bubbleFace === 'shape' ? 'shape' : 'icon';
  const shape = known(BUBBLE_SHAPES, a?.bubbleShape) ?? 'orb';
  const hasFace = face === 'shape' && !!BUBBLE_SHAPES[shape]!.face;
  const eyes = hasFace ? known(BUBBLE_EYES, a?.bubbleEyes) : undefined;
  return {
    face, shape, eyes,
    mouth: hasFace ? known(BUBBLE_MOUTHS, a?.bubbleMouth) : undefined,
    hat: hasFace ? known(BUBBLE_HATS, a?.bubbleHat) : undefined,
    cheeks: hasFace && !!a?.bubbleCheeks,
    follows: !!eyes && !!a?.bubbleEyesFollow && !!BUBBLE_EYES[eyes]!.moves,
    bare: face === 'shape' || (face === 'svg' && !!a?.bubbleSvgBare), // without the round background
    thinking: thinkingOf(a, face === 'shape' && !hasFace, eyes),
  };
}
type BubbleLook = ReturnType<typeof bubbleLook>;

// The face's parts on the shape (its eyes, mouth and hat where the shape says), and how far its hat
// rises above the bubble, px.
function faceParts(look: BubbleLook, f: NonNullable<Shape['face']>): { parts: SvgNode[]; overhang: number } {
  const parts: SvgNode[] = [];
  if (look.cheeks) {
    const y = (f.eyes + f.mouth) / 2 + 1;
    parts.push(...[11.5, 32.5].map((cx): SvgNode => ['ellipse', { cx, cy: y, rx: 3, ry: 1.8, fill: PINK, opacity: 0.7 }]));
  }
  if (look.eyes) {
    const eyes = BUBBLE_EYES[look.eyes]!;
    const drawn = eyes.one ? [eyes.draw(22, f.eyes, 1)] : [eyes.draw(16, f.eyes, -1), eyes.draw(28, f.eyes, 1)];
    parts.push(['g', { class: 'eyes' }, drawn]);
  }
  if (look.mouth) {
    // The mouth it has, and those it makes as the floating chat works, waits or answered (style.ts).
    const reaction = (cls: string, id: string): SvgNode => ['g', { class: `mouth ${cls}` }, BUBBLE_MOUTHS[id]!.draw(f.mouth)];
    parts.push(reaction('rest', look.mouth), reaction('think', 'flat'), reaction('wait', 'open'), reaction('done', look.mouth === 'smile' ? 'grin' : 'smile'));
  }
  if (!look.hat) return { parts, overhang: 0 };
  const hat = BUBBLE_HATS[look.hat]!;
  parts.push(['g', { class: 'hat' }, hat.draw(f.top)]);
  return { parts, overhang: Math.ceil(Math.max(0, -hat.top(f.top))) };
}

// The shape and its face, on the 44 × 44 grid; `eyesY`: where its eyes are, when it has them.
export function shapeTree(look: BubbleLook): { svg: SvgNode; overhang: number; eyesY?: number } {
  const shape = BUBBLE_SHAPES[look.shape]!;
  const face = shape.face ? faceParts(look, shape.face) : { parts: [], overhang: 0 };
  const moves = !!look.eyes && BUBBLE_EYES[look.eyes]!.moves;
  const classes = ['look', `shape-${look.shape}`, shape.idle && `idle-${shape.idle}`, look.eyes && `eyes-${look.eyes}`, moves && 'blinks'];
  const svg: SvgNode = ['svg', { class: classes.filter(Boolean).join(' '), viewBox: '0 0 44 44', width: 44, height: 44, overflow: 'visible', 'aria-hidden': 'true' },
    [['g', { class: 'bodies' }, shape.body], ...face.parts]];
  return { svg, overhang: face.overhang, eyesY: look.eyes ? shape.face?.eyes : undefined };
}
// Where the pupils look, toward a point (dx, dy) px from the eyes: each coordinate within -1…1,
// all the way once the point is `reach` px away or farther.
export function lookOffset(dx: number, dy: number, reach = 120): { x: number; y: number } {
  const d = Math.hypot(dx, dy);
  if (!d) return { x: 0, y: 0 };
  const k = Math.min(1, d / reach) / d;
  return { x: dx * k, y: dy * k };
}
