// The icons the page widget's bubble can show (Settings → Bubble), from Lucide (ISC
// license), imported one by one so that only these are bundled. None chosen: the bubble's ✦.
import {
  Anchor, Atom, Bird, BookOpen, Bot, BotMessageSquare, Brain, BrainCircuit, Briefcase, Cat, Clover, Code, Coffee, Compass, Cpu, Crown,
  Dog, Feather, Flame, Gem, Ghost, Globe, Hand, Heart, Infinity as InfinityIcon, Leaf, Lightbulb, MessageCircle, MessageSquare,
  MessagesSquare, Moon, Orbit, Puzzle, Rabbit, Rocket, Search, Shell, Smile, Snowflake, Sparkle, Sparkles, Squirrel, Star, Sun, Target,
  Terminal, WandSparkles, Wrench, Zap, type IconNode,
} from 'lucide';
import { SVG_NS } from './svg-safe';

export const BUBBLE_ICONS: Record<string, IconNode> = {
  sparkles: Sparkles, sparkle: Sparkle, bot: Bot, 'bot-message': BotMessageSquare, brain: Brain, 'brain-circuit': BrainCircuit,
  'message-circle': MessageCircle, 'message-square': MessageSquare, messages: MessagesSquare, wand: WandSparkles, zap: Zap, star: Star,
  heart: Heart, lightbulb: Lightbulb, rocket: Rocket, compass: Compass, search: Search, globe: Globe, bird: Bird, cat: Cat, dog: Dog,
  rabbit: Rabbit, squirrel: Squirrel, ghost: Ghost, smile: Smile, flame: Flame, leaf: Leaf, sun: Sun, moon: Moon, coffee: Coffee,
  book: BookOpen, briefcase: Briefcase, code: Code, terminal: Terminal, wrench: Wrench, puzzle: Puzzle, gem: Gem, crown: Crown, atom: Atom,
  infinity: InfinityIcon, feather: Feather, anchor: Anchor, cpu: Cpu, orbit: Orbit, shell: Shell, snowflake: Snowflake, clover: Clover,
  target: Target, hand: Hand,
};

// How Lucide icons are drawn: in the current color, on a 24 × 24 grid (the picker draws them the same, in React).
const ICON_SVG = { viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', 'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' } as const;

// "message-circle" → "Message circle", for the picker's labels.
export const bubbleIconLabel = (id: string) => (id.charAt(0).toUpperCase() + id.slice(1)).replace(/-/g, ' ');

// The icon as an SVG element, drawn in the current color (for the bubble, inside its shadow root).
export function bubbleIconSvg(id: string, size = 22): SVGSVGElement | undefined {
  const node = BUBBLE_ICONS[id];
  return node && iconSvg(node, size);
}

// A Lucide icon as an SVG element, drawn in the current color.
export function iconSvg(node: IconNode, size: number): SVGSVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [k, v] of Object.entries({ width: size, height: size, ...ICON_SVG, 'aria-hidden': 'true' })) {
    svg.setAttribute(k, String(v));
  }
  for (const [tag, attrs] of node) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== undefined) child.setAttribute(k, String(v));
    svg.append(child);
  }
  return svg;
}
