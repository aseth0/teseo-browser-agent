// The origins Layers colors text by (core/model-texts MARKS): what each one is, its group and its
// default color, in the palette's families (ui/tokens.css --c-*), each one its own shade: what comes
// from the page in yellows and ambers, from tools in teals and cyans, what you type in blue, what the
// extension knows in greens, its other values in slate. Settings → Appearance lets you change the
// colors; the highlight is the color with transparency, so one color reads well on light and dark backgrounds.
import type { Origin } from '../core/model-texts';

interface OriginInfo {
  origin: Origin;
  label: string;
  group: 'web' | 'extension';
  color: string; // default, #rrggbb
  about: string; // what it marks
}

export const ORIGINS: OriginInfo[] = [
  { origin: 'page', group: 'web', label: 'Page block', color: '#facc15', about: 'the page attached to your message: URL, title, selection, visible elements' },
  { origin: 'template', group: 'web', label: 'Site templates', color: '#f59e0b', about: 'what site templates extract, also for ::site/view mentions' },
  { origin: 'skillValues', group: 'web', label: 'Site skill values', color: '#fde68a', about: 'the page values site skills ask for' },
  { origin: 'mcp', group: 'web', label: 'MCP results', color: '#22d3ee', about: 'what the tools of MCP servers return' },
  { origin: 'history', group: 'web', label: 'Saved conversations', color: '#a3e635', about: 'earlier conversations the model reads or you attach with #' },
  { origin: 'tool', group: 'web', label: 'Page tool results', color: '#2dd4bf', about: 'what the tools that read the page return (and the page after each action), and WebMCP replies' },
  { origin: 'message', group: 'extension', label: 'Your message', color: '#60a5fa', about: 'what you type' },
  { origin: 'memory', group: 'extension', label: 'Memory', color: '#4ade80', about: 'the memory items (Settings → Memory)' },
  { origin: 'skill', group: 'extension', label: 'Skills', color: '#10b981', about: 'the instructions of skills' },
  { origin: 'extension', group: 'extension', label: 'Other extension values', color: '#94a3b8', about: 'every other value the extension fills in (names, URLs, notes, ids…)' },
];

export const ORIGIN_INFO = Object.fromEntries(ORIGINS.map((o) => [o.origin, o])) as Record<Origin, OriginInfo>;

// The class a highlight of that origin has (its color comes from --origin-<origin>).
export const originClass = (origin: Origin) => `origin origin-${origin}`;
