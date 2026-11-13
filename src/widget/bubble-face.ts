// The bubble's face as elements (Settings → Bubble): the icon, the shape with its face, or the user's
// SVG; and, while the folded floating chat works, the thought bubble. For the widget's shadow root and
// for Settings' preview, which draws it the same way. Styled by widget/ui/style.ts.
import type { Appearance } from '../storage/settings-types';
import { onAccent } from '../look/palette';
import { bubbleIconSvg } from './bubble-icons';
import { bubbleLook, shapeTree, type SvgNode } from './bubble-look';
import { safeSvgElement, SVG_NS } from './svg-safe';

export function svgFromTree([tag, attrs, children = []]: SvgNode): SVGElement {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  node.append(...children.map(svgFromTree));
  return node;
}

const BLINK_MS = 4000; // how often the eyes blink: each bubble its own, from this
const BLINK_SPREAD_MS = 3000; // to this much more

export interface BubbleFace {
  look: ReturnType<typeof bubbleLook>;
  nodes: (Node | string)[]; // into the bubble's face
  overhang: number; // px its hat rises above the bubble
  eyesY?: number; // px from the bubble's top, where the eyes look from
}

export function bubbleFace(a: Appearance | undefined): BubbleFace {
  const look = bubbleLook(a);
  const nodes: (Node | string)[] = [];
  let overhang = 0;
  let eyesY: number | undefined;
  if (look.face === 'shape') {
    const tree = shapeTree(look);
    const svg = svgFromTree(tree.svg);
    svg.style.setProperty('--blink', `${Math.round(BLINK_MS + Math.random() * BLINK_SPREAD_MS)}ms`);
    nodes.push(svg);
    ({ overhang, eyesY } = tree);
  } else if (look.face === 'svg') {
    const svg = safeSvgElement(a?.bubbleSvg);
    if (svg) svg.classList.add('own');
    nodes.push(svg ?? '✦');
  } else {
    nodes.push((a?.bubbleIcon && bubbleIconSvg(a.bubbleIcon)) || '✦');
  }
  if (look.thinking === 'thought') {
    const thought = document.createElement('span');
    thought.className = 'thought';
    thought.append(...[0, 1, 2].map(() => document.createElement('i')));
    nodes.push(thought);
  }
  return { look, nodes, overhang, eyesY };
}

// The face drawn into the bubble, with the bubble's data attributes for its look (style.ts): the
// face, bare or not, and how it thinks.
export function drawBubbleFace(bubble: HTMLElement, into: HTMLElement, a: Appearance | undefined): BubbleFace {
  const drawn = bubbleFace(a);
  into.replaceChildren(...drawn.nodes);
  bubble.dataset.look = drawn.look.face;
  bubble.dataset.think = drawn.look.thinking;
  bubble.toggleAttribute('data-bare', drawn.look.bare);
  return drawn;
}

// The bubble's own color on its host, else the accent (style.ts --fill and --ink).
export function setBubbleColor(host: HTMLElement, color: string | undefined) {
  for (const [name, value] of [['--bubble', color], ['--on-bubble', color && onAccent(color)]] as const) {
    if (value) host.style.setProperty(name, value);
    else host.style.removeProperty(name);
  }
}
