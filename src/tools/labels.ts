// The labels of custom tools (Settings → Custom tools): the user's own, on each tool (CustomTool.labels),
// each with the color picked for it; and the kind of each tool (script, HTTP request, made from a tool,
// by the model), in the palette's colors: a tool's, or the model's. The list is filtered by either. Only for the user: the model sees none.
import { browser } from 'wxt/browser';
import { storageRecord } from '../storage/area';
import type { CustomTool } from './custom/types';
import { HTTP_BASE } from './http';
import { SCRIPT_BASE } from './custom/script-tool';
import { serialized } from '../storage/serial';
import { watchKey } from '../storage/watch';

export const LABEL_COLORS = ['gray', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'purple', 'pink'] as const;
export type LabelColor = (typeof LABEL_COLORS)[number];
export type LabelColors = Record<string, LabelColor>;

const KEY = 'customToolLabelColors';

// As written on a tool: lowercase, words joined by "-".
export const labelName = (raw: string) => raw.trim().toLowerCase().replace(/\s+/g, '-');

// Its color: the one picked, else one of the name's own (the same every time).
export function labelColor(name: string, colors: LabelColors): LabelColor {
  if (colors[name]) return colors[name];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return LABEL_COLORS[1 + (h % (LABEL_COLORS.length - 1))]!; // never gray: that one is picked
}

export const loadLabelColors = (): Promise<LabelColors> => storageRecord<LabelColor>('local', KEY);
const serial = serialized(KEY);
export const setLabelColor = (name: string, color: LabelColor): Promise<void> =>
  serial(async () => browser.storage.local.set({ [KEY]: { ...(await loadLabelColors()), [name]: color } }));
export function onLabelColorsChanged(cb: (colors: LabelColors) => void): () => void {
  return watchKey('local', KEY, (c) => cb((c.newValue as LabelColors | undefined) ?? {}));
}

// What kind of tool it is, in a fixed color.
interface ToolKind {
  id: string;
  label: string;
  color: 'tool' | 'model';
}
export const KINDS: ToolKind[] = [
  { id: 'script', label: 'script', color: 'tool' },
  { id: 'http', label: 'HTTP request', color: 'tool' },
  { id: 'derived', label: 'made from a tool', color: 'tool' },
  { id: 'model', label: 'by the model', color: 'model' },
];
export function kindsOf(c: CustomTool): string[] {
  const kind = c.base === SCRIPT_BASE ? 'script' : c.base === HTTP_BASE ? 'http' : 'derived';
  return c.createdBy === 'model' ? [kind, 'model'] : [kind];
}

// A filter: the kinds and labels picked; a tool shows when it has every one of them.
export const matches = (c: CustomTool, picked: { kinds: string[]; labels: string[] }) =>
  picked.kinds.every((k) => kindsOf(c).includes(k)) && picked.labels.every((l) => (c.labels ?? []).includes(l));
