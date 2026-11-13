// The voice profiles as Settings → Speak edits them: a new one, a copy, one changed or removed, and the
// default one kept pointing at a profile that is there.
import type { Settings } from '../storage/settings';
import type { SpeakSettings, VoiceProfile } from '../storage/settings-types';
import { profilesOf, speakOf } from './settings';

// A name not taken yet: "Voice", "Voice 2"…; a copy, "Calm (copy)".
export function freeName(base: string, taken: readonly string[]): string {
  const lower = new Set(taken.map((t) => t.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) if (!lower.has(`${base} ${n}`.toLowerCase())) return `${base} ${n}`;
}

// A new profile: the first provider, no model nor voice yet.
export function newProfile(s: Pick<Settings, 'providers' | 'speak'>, id: string = crypto.randomUUID()): VoiceProfile {
  const provider = s.providers[0];
  return { id, name: freeName('Voice', profilesOf(s).map((p) => p.name)), ...(provider && { providerId: provider.id }), speed: 1 };
}
export const copyOfProfile = (p: VoiceProfile, s: Pick<Settings, 'speak'>, id: string = crypto.randomUUID()): VoiceProfile => ({
  ...p,
  id,
  name: freeName(`${p.name} (copy)`, profilesOf(s).map((x) => x.name)),
});

export const withProfile = (s: Pick<Settings, 'speak'>, p: VoiceProfile): SpeakSettings => {
  const all = profilesOf(s);
  return { ...speakOf(s), profiles: all.some((x) => x.id === p.id) ? all.map((x) => (x.id === p.id ? p : x)) : [...all, p] };
};
export function withoutProfile(s: Pick<Settings, 'speak'>, id: string): SpeakSettings {
  const { defaultProfileId, ...rest } = speakOf(s);
  return { ...rest, profiles: profilesOf(s).filter((p) => p.id !== id), ...(defaultProfileId && defaultProfileId !== id && { defaultProfileId }) };
}
