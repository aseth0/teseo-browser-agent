// The texts as the user has them: the defaults (TEXT_DEFS) with the overrides from the settings,
// filled with their values.

import { markValue, neutralizeTags } from '../origin-marks';
import { EXTERNAL_TEXTS } from './defs-external';
import { REPLY_TEXTS } from './defs-replies';
import { SPEECH_TEXTS } from './defs-speech';
import { SYSTEM_TEXTS } from './defs-system';
import { USER_TEXTS } from './defs-user';
import type { TextDef } from './types';

export const TEXT_DEFS = { ...SYSTEM_TEXTS, ...USER_TEXTS, ...REPLY_TEXTS, ...SPEECH_TEXTS, ...EXTERNAL_TEXTS };

export type TextId = keyof typeof TEXT_DEFS;

export const textIds = (filter: (def: TextDef) => boolean) => (Object.keys(TEXT_DEFS) as TextId[]).filter((id) => filter(TEXT_DEFS[id]));

let overrides: Record<string, string> = {};

export function setTextOverrides(o: Record<string, string> | undefined): void {
  overrides = o ?? {};
}

// Tool descriptions are overridable too, under "tool:<dotted name>".
export const toolTextKey = (toolName: string) => `tool:${toolName}`;
export const toolDescription = (toolName: string, fallback: string) => overrides[toolTextKey(toolName)] ?? fallback;

const PLACEHOLDER = /\{([a-z_]+)\}/g;

export const placeholdersOf = (template: string) => [...new Set([...template.matchAll(PLACEHOLDER)].map((m) => m[1]!))];

// Single pass, so placeholders inside the values (page content) are never expanded. No value can
// open or close an untrusted block: its "<untrusted_…" tags are neutralized, whatever its origin
// (a page's tool name, a server's, text the model wrote).
export function fill(template: string, vars: Record<string, string> = {}): string {
  return template.replace(PLACEHOLDER, (m, k: string) => (k in vars ? markValue(neutralizeTags(vars[k]!)) : m));
}

export const text = (id: TextId, vars?: Record<string, string>) => fill(overrides[id] ?? TEXT_DEFS[id].text, vars);

// What an action did, reported by the page (which never formats model text).
export type ActionOutcome =
  | { kind: 'click'; covered?: string } // covered: what is on top of it at its center (synthetic clicks only)
  | { kind: 'type'; submit?: boolean }
  | { kind: 'select'; option: string }
  | { kind: 'key'; key: string }
  | { kind: 'scroll'; direction: string }
  | { kind: 'hover' }
  | { kind: 'drag' };

export function actionNote(o: ActionOutcome): string {
  switch (o.kind) {
    case 'click':
      return o.covered ? text('action.click_covered', { other: o.covered }) : text('action.click');
    case 'type':
      return text(o.submit ? 'action.type_submit' : 'action.type');
    case 'select':
      return text('action.select', { option: o.option });
    case 'key':
      return text('action.key', { key: o.key });
    case 'scroll':
      return text('action.scroll', { direction: o.direction });
    case 'hover':
      return text('action.hover');
    case 'drag':
      return text('action.drag');
  }
}
