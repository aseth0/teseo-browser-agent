// Voice profiles as JSON, on their own (Settings → Speak): { "voiceProfiles": [...] }, as the other
// sections' item exports write theirs. A profile names its provider by id, as an agent does (agents/io):
// one whose provider is not among the user's comes in without one, to choose. An import adds profiles,
// or replaces the one of the same name (keeping its id, so the agents and the default that point at it
// still do); the default profile is not changed. The paste box also takes a plain list, as an earlier
// tool wrote it: "Name=voice@speed" entries apart by commas, semicolons or new lines (speed optional).
import { isObject } from '../core/util';
import { EXPORT_TYPE } from '../storage/export-file';
import { importNamed, listFrom, type ImportRow } from '../storage/import';
import type { Settings } from '../storage/settings';
import type { VoiceProfile } from '../storage/settings-types';
import { clampSpeed, profilesOf } from './settings';

export const PROFILES_KEY = 'voiceProfiles';
export const PROFILES_FILE = 'voice-profiles.json';

type Shared = Omit<VoiceProfile, 'id'>;

// Only what a profile is, field by field: nothing else it may carry goes (it holds no key; its
// provider's is the provider's, which never goes either).
const shared = (p: VoiceProfile): Shared => ({
  name: p.name,
  ...(typeof p.providerId === 'string' && p.providerId && { providerId: p.providerId }),
  ...(typeof p.model === 'string' && p.model && { model: p.model }),
  ...(typeof p.voice === 'string' && p.voice && { voice: p.voice }),
  ...(typeof p.speed === 'number' && Number.isFinite(p.speed) && { speed: p.speed }),
  ...(typeof p.language === 'string' && p.language && { language: p.language }),
});

export const exportProfiles = (profiles: VoiceProfile[]): string => JSON.stringify({ [PROFILES_KEY]: profiles.map(shared) }, null, 2);

// What an import read: a row each, notes, and whether it was the plain list (its profiles then take
// the provider and model chosen in the preview, which says so).
export interface ProfileRead {
  rows: ImportRow<VoiceProfile>[];
  notes: string[];
  plain?: boolean;
}

// A reading-rules language as stored: 'none', or a language code ("es", "es-ES"); anything else is not one.
const LANGUAGE = /^(none|[a-z]{2,3}([-_][a-z0-9]{2,8})?)$/i;

type Built = Shared | { skip: string };

// One profile of a JSON file, checked: its name and voice, its speed bounded as the editor bounds it,
// its provider kept only when it is one of the user's.
function buildProfile(raw: unknown, providerIds: Set<string>): Built {
  if (!isObject(raw)) return { skip: 'an entry that is not a profile.' };
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return { skip: 'a profile without a name.' };
  const voice = typeof raw.voice === 'string' ? raw.voice.trim() : '';
  if (!voice) return { skip: `${name}: it has no voice.` };
  if (raw.model !== undefined && typeof raw.model !== 'string') return { skip: `${name}: its model is not text.` };
  if (raw.speed !== undefined && (typeof raw.speed !== 'number' || !Number.isFinite(raw.speed))) return { skip: `${name}: its speed is not a number.` };
  const model = typeof raw.model === 'string' ? raw.model.trim() : '';
  const language = typeof raw.language === 'string' && LANGUAGE.test(raw.language.trim()) ? raw.language.trim() : undefined;
  const providerId = typeof raw.providerId === 'string' && providerIds.has(raw.providerId) ? raw.providerId : undefined;
  return {
    name,
    ...(providerId && { providerId }),
    ...(model && { model }),
    voice,
    ...(typeof raw.speed === 'number' && { speed: clampSpeed(raw.speed) }),
    ...(language && { language }),
  };
}

// The profiles in a JSON: this export, a list, one alone; or those of Settings → Export and import's
// file (its settings part), or of that part alone.
function jsonList(text: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Not JSON, nor a list of Name=voice entries.');
  }
  if (isObject(parsed) && parsed.type === EXPORT_TYPE) return speakProfiles(isObject(parsed.parts) ? parsed.parts.settings : undefined);
  if (isObject(parsed) && isObject(parsed.speak) && !(PROFILES_KEY in parsed)) return speakProfiles(parsed);
  return listFrom(text, PROFILES_KEY);
}

function speakProfiles(settingsPart: unknown): unknown[] {
  const profiles = isObject(settingsPart) && isObject(settingsPart.speak) ? settingsPart.speak.profiles : undefined;
  if (!Array.isArray(profiles)) throw new Error('No voice profiles in this file: its settings have none.');
  return profiles;
}

// The plain list's entries, each as a profile without a provider nor a model (chosen in the preview)
// and without reading rules, or why it is left out.
function plainList(text: string): { name: string; built: Built }[] {
  return text
    .split(/[,;\n]+/)
    .map((e) => e.trim())
    .filter(Boolean)
    .map((entry) => {
      const m = /^([^=@]+)=([^=@]+)(?:@([^=@]*))?$/.exec(entry);
      const name = m?.[1]!.trim() ?? '';
      const voice = m?.[2]!.trim() ?? '';
      if (!m || !name || !voice) return { name: entry, built: { skip: `"${entry}": not Name=voice.` } };
      const speedText = m[3]?.trim();
      const speed = speedText ? Number(speedText) : undefined;
      if (speed !== undefined && !Number.isFinite(speed)) return { name, built: { skip: `${name}: its speed "${speedText}" is not a number.` } };
      return { name, built: { name, voice, ...(speed !== undefined && { speed: clampSpeed(speed) }), language: 'none' } };
    });
}

// The profiles in what was pasted or read from a file, each new, replacing the one of its name, or
// left out (why); throws when it is none of the forms read here.
export function readProfiles(text: string, s: Pick<Settings, 'providers' | 'speak'>): ProfileRead {
  const trimmed = text.replace(/^﻿/, '').trim();
  const plain = !/^[[{]/.test(trimmed);
  const providerIds = new Set(s.providers.map((p) => p.id));
  const entries = plain ? plainList(trimmed) : jsonList(trimmed).map((raw) => ({ name: isObject(raw) && typeof raw.name === 'string' ? raw.name : '', built: buildProfile(raw, providerIds) }));
  if (plain && !entries.length) throw new Error('Nothing to import: paste the JSON of an export, or Name=voice entries.');
  const { rows } = importNamed<VoiceProfile>({
    list: entries.map((e) => ({ name: e.name, built: e.built })),
    existing: profilesOf(s),
    build: (item) => item.built as Built,
    problems: () => [],
  });
  const said: ImportRow<VoiceProfile>[] = plain ? rows.map((r) => (r.why ? { ...r, why: r.why.replace('the file has this name', 'the list has this name') } : r)) : rows;
  const unmatched = plain ? [] : said.filter((r) => r.item && !r.item.providerId).map((r) => r.name);
  const notes = [
    ...(unmatched.length ? [`${unmatched.join(', ')}: ${unmatched.length === 1 ? 'its provider is' : 'their provider is'} not among yours. ${unmatched.length === 1 ? 'It comes' : 'They come'} in without one: choose it in Settings → Speak.`] : []),
  ];
  return { rows: said, notes, ...(plain && { plain: true }) };
}

// The profiles chosen, added to the user's: each replacing the one of its id (the one of its name, whose
// id it took) or after them; the default and the rest of Speak's settings as they are.
export function withImported(s: Pick<Settings, 'speak'>, picked: VoiceProfile[]): NonNullable<Settings['speak']> {
  const all = profilesOf(s);
  const byId = new Map(picked.map((p) => [p.id, p]));
  return { ...(s.speak ?? {}), profiles: [...all.map((p) => byId.get(p.id) ?? p), ...picked.filter((p) => !all.some((x) => x.id === p.id))] };
}

// The plain list's profiles with the provider and model chosen for them (none chosen: none).
export const withTarget = (picked: VoiceProfile[], target: { providerId?: string; model?: string }): VoiceProfile[] =>
  picked.map((p) => ({ ...p, ...(target.providerId && { providerId: target.providerId }), ...(target.model?.trim() && { model: target.model.trim() }) }));
