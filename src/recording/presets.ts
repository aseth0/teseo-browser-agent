// The presets of a recording (Settings → Recording): what it keeps of the calls a page makes. Three
// ship with the extension and can be edited; the user adds their own. A call a preset leaves out is
// only counted (recording/filter). No preset can keep more than the recording's limits.
import type { CallType, RecordingPreset, Settings } from '../storage/settings-types';
import { MAX_BODY, MAX_MS } from './recording';

export type { CallType, RecordingPreset } from '../storage/settings-types';
export const CALL_TYPES: CallType[] = ['fetch', 'document', 'script', 'socket'];

export const MIN_BODY = 1000; // characters: the least a preset keeps of a body (Settings → Recording)
export const MAX_MINUTES = MAX_MS / 60_000;

// Analytics, tracking, pixels and ads by the words in their address, never by a company's name.
export const LEAVE_OUT_PATTERNS = ['*analytics*', '*tracking*', '*/collect', '*/collect?*', '*/pixel', '*/pixel?*', '*/pixel.*', '*/ads/*'];

export const DEFAULT_PRESET_ID = 'api';
const base = { sites: 'all' as const, include: [], methods: [], maxBody: MAX_BODY, maxMinutes: MAX_MINUTES };
export const SHIPPED_PRESETS: RecordingPreset[] = [
  { ...base, id: 'api', name: 'API calls', types: ['fetch', 'socket'], exclude: LEAVE_OUT_PATTERNS, status: 'all', answers: 'text', dedupe: true },
  { ...base, id: 'everything', name: 'Everything', types: [...CALL_TYPES], exclude: [], status: 'all', answers: 'all', dedupe: false },
  { ...base, id: 'errors', name: 'Errors only', types: ['fetch', 'document', 'socket'], exclude: LEAVE_OUT_PATTERNS, status: 'errors', answers: 'all', dedupe: true },
];

const within = (n: number, min: number, max: number) => (Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n))) : max);
export const clampPreset = (p: RecordingPreset): RecordingPreset => ({ ...p, maxBody: within(p.maxBody, MIN_BODY, MAX_BODY), maxMinutes: within(p.maxMinutes, 1, MAX_MINUTES) });

const strings = (v: unknown) => Array.isArray(v) && v.every((x) => typeof x === 'string');
// One read back from the settings, which another version of the extension may have written.
function isPreset(v: unknown): v is RecordingPreset {
  if (!v || typeof v !== 'object') return false;
  const p = v as Record<string, unknown>;
  return typeof p.id === 'string' && typeof p.name === 'string' && strings(p.types) && (p.sites === 'all' || p.sites === 'this-site')
    && strings(p.include) && strings(p.exclude) && strings(p.methods) && ['all', 'errors', 'success'].includes(p.status as string)
    && (p.answers === 'all' || p.answers === 'text') && typeof p.dedupe === 'boolean' && typeof p.maxBody === 'number' && typeof p.maxMinutes === 'number';
}

// The shipped presets (as the user edited them), then the user's own.
export function presetsOf(s: Settings): (RecordingPreset & { builtIn: boolean; edited: boolean })[] {
  const stored = (s.recordingPresets ?? []).filter(isPreset);
  const shipped = SHIPPED_PRESETS.map((p) => {
    const edit = stored.find((x) => x.id === p.id);
    return { ...clampPreset(edit ?? p), builtIn: true, edited: !!edit };
  });
  const own = stored.filter((x) => !SHIPPED_PRESETS.some((p) => p.id === x.id)).map((p) => ({ ...clampPreset(p), builtIn: false, edited: false }));
  return [...shipped, ...own];
}

// The preset asked for, else the default one, else API calls.
export function presetFor(s: Settings, id?: string): RecordingPreset {
  const all = presetsOf(s);
  const { builtIn: _b, edited: _e, ...preset } = all.find((p) => p.id === id) ?? all.find((p) => p.id === s.recordingPreset) ?? all.find((p) => p.id === DEFAULT_PRESET_ID)!;
  return preset;
}

// What Settings → Recording saves: the stored presets with one edited or added (clamped)...
export function withPreset(s: Settings, p: RecordingPreset): RecordingPreset[] {
  const stored = (s.recordingPresets ?? []).filter(isPreset);
  const saved = clampPreset(p);
  return stored.some((x) => x.id === p.id) ? stored.map((x) => (x.id === p.id ? saved : x)) : [...stored, saved];
}
// ...or taken out: a shipped one goes back to how it ships. None left: undefined.
export function withoutPreset(s: Settings, id: string): RecordingPreset[] | undefined {
  const left = (s.recordingPresets ?? []).filter(isPreset).filter((x) => x.id !== id);
  return left.length ? left : undefined;
}
// A new preset, a copy of another.
export function copyOfPreset(p: RecordingPreset, ids: string[]): RecordingPreset {
  let n = 1;
  while (ids.includes(`own-${n}`)) n++;
  return { ...p, id: `own-${n}`, name: `${p.name} (copy)` };
}
