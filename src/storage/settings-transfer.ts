// The settings part of an export (Settings → Export and import): only the settings listed here, each
// without what belongs to this browser (the bookmark folder, the microphone, the tool groups seen).
// What has its own part (providers, themes, MCP servers) and what names this browser's things (the
// active provider, model and agent, the agents' order) never goes. Imported setting by setting: only
// those that differ from yours are offered, and one of the wrong kind is left out.
import { isObject, stableJson } from '../core/util';
import { retentionLimit } from './retention';
import type { ImportRow } from './import';
import type { Settings } from './settings-types';

type Kind = 'string' | 'boolean' | 'object' | 'list';

// The settings that travel: their kind, and their name on the import's preview.
const SETTINGS: Partial<Record<keyof Settings, [Kind, string]>> = {
  aboutUser: ['string', 'About you'],
  dateTime: ['object', 'Date & time'],
  systemPrompt: ['string', 'System prompt'],
  promptTexts: ['object', 'Model texts'],
  browserAgent: ['object', 'Browser agent'],
  defaultCanAsk: ['boolean', 'Browser may ask other agents'],
  includePage: ['boolean', 'Attach the active page'],
  panelFollows: ['boolean', 'Side panel follows tabs'],
  thinking: ['object', 'Thinking levels'],
  disabledTools: ['list', 'Tools off'],
  tools: ['object', 'Tools'],
  mentions: ['object', 'Mentions'],
  memory: ['object', 'Memory options'],
  autoInject: ['object', 'Auto-inject'],
  bookmarks: ['object', 'Bookmarks'],
  compaction: ['object', 'Compaction'],
  context: ['object', 'Compaction: what is not resent'],
  limits: ['object', 'Limits'],
  contextWindows: ['object', 'Context windows'],
  chatRender: ['string', 'Chat view'],
  chatView: ['object', 'Chat display'],
  display: ['object', 'Display'],
  appearance: ['object', 'Appearance'],
  chatWindow: ['object', 'Chat window'],
  popup: ['object', 'Popup'],
  history: ['object', 'History'],
  voice: ['object', 'Voice'],
  speak: ['object', 'Speak'], // its profiles name providers by id, as Voice does: the providers' part carries them
  webSearch: ['object', 'Web search'],
  pageWidget: ['object', 'Page widget'],
  devtoolsTools: ['boolean', 'DevTools engine'],
  devtoolsMask: ['string', 'DevTools masked fields'],
  recordingPresets: ['list', 'Recording presets'],
  recordingPreset: ['string', 'Recording preset at start'],
  audioTo: ['string', 'Tab audio goes to'],
  interactions: ['object', 'Alerts'],
  logs: ['object', 'Logs'],
  updateCheck: ['boolean', 'Check for a new version'],
};

// The fields of a setting that belong to this browser: never exported, and yours kept on import.
const LOCAL: Partial<Record<keyof Settings, string[]>> = {
  bookmarks: ['rootId'],
  voice: ['deviceId'],
  chatView: ['seenToolGroups'],
};

// What an imported setting is made safe as: History's retention only as a whole number from 1 up (a
// file's 0.5 or -3 would delete conversations on the next save), any other left out; Speak's profiles.
const SANITIZE: Partial<Record<keyof Settings, (v: Record<string, unknown>) => Record<string, unknown>>> = {
  // Speak's voice profiles: only those that are objects with an id and a name.
  speak: (v) => (Array.isArray(v.profiles) ? { ...v, profiles: v.profiles.filter((p) => isObject(p) && typeof p.id === 'string' && typeof p.name === 'string') } : v),
  history: (v) => {
    const { keepDays, keepCount, ...rest } = v;
    const days = retentionLimit(keepDays);
    const count = retentionLimit(keepCount);
    return { ...rest, ...(days && { keepDays: days }), ...(count && { keepCount: count }) };
  },
};

const kindOf = (v: unknown): Kind | undefined =>
  typeof v === 'string' ? 'string' : typeof v === 'boolean' ? 'boolean' : Array.isArray(v) ? 'list' : isObject(v) ? 'object' : undefined;

const withoutLocal = (key: keyof Settings, v: unknown) => {
  const local = LOCAL[key];
  return local && isObject(v) ? Object.fromEntries(Object.entries(v).filter(([k]) => !local.includes(k))) : v;
};

export const settingLabel = (key: string) => SETTINGS[key as keyof Settings]?.[1] ?? key;

export function exportSettingsPart(s: Settings): string {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(SETTINGS) as (keyof Settings)[]) {
    const v = withoutLocal(key, s[key]);
    if (v !== undefined && !(isObject(v) && !Object.keys(v).length)) out[key] = v;
  }
  return JSON.stringify(out, null, 2);
}

export interface SettingChange {
  key: keyof Settings;
  label: string;
  yours: unknown;
  value: unknown; // the file's, with this browser's fields of yours in it
}

// The settings of the part that differ from yours, a row each; those not listed, or of the wrong kind,
// left out.
export function importSettingsPart(json: string, s: Settings): ImportRow<SettingChange>[] {
  const parsed = JSON.parse(json) as unknown;
  if (!isObject(parsed)) throw new Error('The settings part is not an object.');
  const rows: ImportRow<SettingChange>[] = [];
  for (const [k, raw] of Object.entries(parsed)) {
    const key = k as keyof Settings;
    const def = SETTINGS[key];
    if (!def) {
      rows.push({ name: k, status: 'left-out', why: `${k}: not a setting this version imports.` });
      continue;
    }
    if (kindOf(raw) !== def[0]) {
      rows.push({ name: def[1], status: 'left-out', why: `${def[1]}: not a${def[0] === 'object' ? 'n' : ''} ${def[0]}.` });
      continue;
    }
    const sanitize = SANITIZE[key];
    const file = withoutLocal(key, sanitize && isObject(raw) ? sanitize(raw) : raw);
    const yours = s[key];
    if (stableJson(file) === stableJson(withoutLocal(key, yours))) continue;
    const kept = LOCAL[key] && isObject(yours) ? Object.fromEntries(Object.entries(yours).filter(([f]) => LOCAL[key]!.includes(f))) : {};
    const value = isObject(file) ? { ...(file), ...kept } : file;
    rows.push({ name: def[1], status: 'replaces', item: { key, label: def[1], yours, value } });
  }
  return rows;
}

// The settings with the changes picked.
export const withSettingChanges = (s: Settings, changes: SettingChange[]): Settings => ({ ...s, ...Object.fromEntries(changes.map((c) => [c.key, c.value])) });

// A value as the preview shows it: short.
export function settingSummary(v: unknown): string {
  if (v === undefined) return 'default';
  if (typeof v === 'boolean') return v ? 'On' : 'Off';
  if (typeof v === 'string') return v.length > 60 ? `“${v.slice(0, 57)}…”` : `“${v}”`;
  if (Array.isArray(v)) return `${v.length} ${v.length === 1 ? 'item' : 'items'}`;
  if (isObject(v)) {
    const n = Object.keys(v).length;
    return `${n} ${n === 1 ? 'field' : 'fields'}`;
  }
  return String(v);
}
