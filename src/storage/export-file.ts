// Settings → Export and import: one file with the parts the user picks. Each part holds what that
// section's own Export writes (skills: { "skills": [...] }, a theme file, an mcpServers object…), so the
// section's import reads it as it is, and a part copied out alone still imports there:
//   { "type": "teseo-export", "version": 1, "exportedAt": ISO time, "app": { name, version },
//     "parts": { "<kind>": <that section's file>, … }, "leftOut": [what is never in it] }
// Secrets never go: the sections' exports leave them out, and every part but the conversations is
// scrubbed again before it is written (scrubSecrets). An import also takes one section's file alone,
// as its one part.
import { API_KEY_PLACEHOLDER, isObject } from '../core/util';
import { otherKind } from './transfer';

export const EXPORT_TYPE = 'teseo-export';
export const EXPORT_VERSION = 1;

export type PartKind = 'agents' | 'skills' | 'templates' | 'memory' | 'wordBlacklist' | 'customTools' | 'mcpServers' | 'actions' | 'theme' | 'conversations' | 'providers' | 'settings';

export interface PartInfo {
  kind: PartKind;
  label: string;
  group: string;
  about?: string; // what it holds, or leaves out
  off?: boolean; // off at first: personal, or large
}

// The parts, in the order both screens list them, under the groups of the Settings menu.
export const PARTS: PartInfo[] = [
  { kind: 'agents', label: 'Agents', group: 'What the model gets', about: 'Their skills, templates and tools go by name, not copied.' },
  { kind: 'skills', label: 'Skills', group: 'What the model gets', about: 'Yours: the built-in ones come with every copy of Teseo.' },
  { kind: 'templates', label: 'Site templates', group: 'What the model gets', about: 'Yours: the built-in ones come with every copy of Teseo.' },
  { kind: 'memory', label: 'Memory', group: 'What the model gets', about: 'What the model saved about you and sites. Off at first: it may be personal.', off: true },
  { kind: 'wordBlacklist', label: 'Word blacklist', group: 'What the model gets', about: 'The terms kept from the model and their replacements. Off at first: they are the words you hide.', off: true },
  { kind: 'customTools', label: 'Custom tools', group: 'Tools', about: 'Without header values or {{secret:…}} values.' },
  { kind: 'mcpServers', label: 'MCP servers', group: 'Tools', about: 'Without header values or sign-ins: sign in again after import.' },
  { kind: 'actions', label: 'Actions', group: 'Tools' },
  { kind: 'theme', label: 'Themes', group: 'Chat', about: 'Your own themes, with the bubble’s look.' },
  { kind: 'conversations', label: 'Conversations', group: 'Chat', about: 'Every saved chat. Off at first: large and personal.', off: true },
  { kind: 'providers', label: 'Providers', group: 'Connections and settings', about: 'Addresses, models and options, without API keys or header values: add each key after import.' },
  { kind: 'settings', label: 'Settings', group: 'Connections and settings', about: 'About you, system prompt, model texts, tools on or off, limits, compaction, appearance, display, chat window, auto-inject, history, voice, web search, recording presets, logs. Not what belongs to this browser: keys, website access, the bookmark folder, the microphone.' },
];
export const partInfo = (kind: PartKind) => PARTS.find((p) => p.kind === kind)!;
const KINDS = new Set<string>(PARTS.map((p) => p.kind));

// What never goes in a file, said in it (and on both screens).
export const LEFT_OUT = ['API keys', 'header values', 'MCP sign-ins', '{{secret:…}} values', 'website access'];

export interface ExportMeta {
  exportedAt?: string;
  app?: { name?: string; version?: string };
}

// Keys whose value is a secret wherever they are, and those whose values are (a header's name stays,
// so the import can say what to fill in).
const SECRET_KEYS = new Set(['apiKey', 'clientSecret', 'secrets', 'accessToken', 'refreshToken', 'token', 'password']);
const HEADER_KEYS = new Set(['headers', 'extraHeaders']);
const keptValue = (v: unknown) => (typeof v === 'string' && v.includes(API_KEY_PLACEHOLDER) ? v : ''); // "{{apiKey}}" names the key, it is not one

// A part without anything secret in it, at any depth: those keys dropped, headers' values emptied
// (as an object {name: value}, or a list of {name, value}).
export function scrubSecrets(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(scrubSecrets);
  if (!isObject(v)) return v;
  const out: Record<string, unknown> = {};
  for (const [k, value] of Object.entries(v)) {
    if (SECRET_KEYS.has(k)) continue;
    if (HEADER_KEYS.has(k) && isObject(value)) out[k] = Object.fromEntries(Object.entries(value).map(([name, h]) => [name, keptValue(h)]));
    else if (HEADER_KEYS.has(k) && Array.isArray(value)) out[k] = value.map((h: unknown) => (isObject(h) ? { ...h, value: keptValue(h.value) } : h));
    else out[k] = scrubSecrets(value);
  }
  return out;
}

// The file of the parts given, each as its section's export (JSON) wrote it; in PARTS' order.
export function buildExportFile(parts: Partial<Record<PartKind, string>>, meta: { now?: Date; version?: string } = {}): string {
  const written: Partial<Record<PartKind, unknown>> = {};
  for (const { kind } of PARTS) {
    const json = parts[kind];
    if (json === undefined) continue;
    const parsed = JSON.parse(json) as unknown;
    written[kind] = kind === 'conversations' ? parsed : scrubSecrets(parsed);
  }
  return JSON.stringify(
    { type: EXPORT_TYPE, version: EXPORT_VERSION, exportedAt: (meta.now ?? new Date()).toISOString(), app: { name: 'Teseo', ...(meta.version && { version: meta.version }) }, parts: written, leftOut: LEFT_OUT },
    null,
    1,
  );
}

export interface ReadFile {
  meta: ExportMeta;
  parts: { kind: PartKind; json: string }[]; // each as its section's import reads it, in PARTS' order
  unknown: string[]; // parts this version does not read (from a newer one)
  single: boolean; // one section's file, not an export of several
}

// The parts of a file: an export of several, or one section's own file (its kind told as the
// sections' imports tell another's: storage/transfer). Throws why it is neither.
export function readExportFile(text: string): ReadFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^﻿/, ''));
  } catch {
    throw new Error('Not JSON.');
  }
  if (isObject(parsed) && parsed.type === EXPORT_TYPE) {
    if (typeof parsed.version !== 'number' || parsed.version > EXPORT_VERSION) throw new Error(`Export version ${JSON.stringify(parsed.version)}: this version of Teseo reads version ${EXPORT_VERSION}. Update Teseo to import it.`);
    if (!isObject(parsed.parts)) throw new Error('No "parts" in this export.');
    const given = parsed.parts;
    const app = isObject(parsed.app) ? { ...(typeof parsed.app.name === 'string' && { name: parsed.app.name }), ...(typeof parsed.app.version === 'string' && { version: parsed.app.version }) } : undefined;
    return {
      meta: { ...(typeof parsed.exportedAt === 'string' && { exportedAt: parsed.exportedAt }), ...(app && { app }) },
      parts: PARTS.filter((p) => given[p.kind] !== undefined).map((p) => ({ kind: p.kind, json: JSON.stringify(given[p.kind]) })),
      unknown: Object.keys(given).filter((k) => !KINDS.has(k)),
      single: false,
    };
  }
  const kind = singleKind(parsed);
  if (!kind) throw new Error('Not a Teseo export, nor a file of one section.');
  return { meta: {}, parts: [{ kind, json: JSON.stringify(parsed) }], unknown: [], single: true };
}

// The section a file of one is of: those the sections' imports tell apart, and the two only this
// screen imports (conversations, providers).
function singleKind(parsed: unknown): PartKind | undefined {
  if (isObject(parsed) && Array.isArray(parsed.conversations)) return 'conversations';
  if (isObject(parsed) && Array.isArray(parsed.providers)) return 'providers';
  if (isObject(parsed) && Array.isArray(parsed.history) && typeof parsed.id === 'string') return 'conversations'; // one exported alone
  return otherKind(parsed, '');
}

// A file's name: teseo-export-YYYY-MM-DD.json.
export const exportFileName = (now = new Date()) => `teseo-export-${now.toISOString().slice(0, 10)}.json`;
