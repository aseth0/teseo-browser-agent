// Settings → Speak as a reading uses it: on or off, the voice profiles and the default one, the pieces'
// sizes, whose reading rules apply and the user's pairs.
import type { ProviderConfig, Settings } from '../storage/settings';
import type { SpeakSettings, VoiceProfile } from '../storage/settings-types';
import { clampSize, FIRST_PIECE, PIECE_SIZE } from './pieces';
import type { PlanOptions } from './plan';

export const SPEED = { default: 1, min: 0.25, max: 4, step: 0.05 };
export const clampSpeed = (v: number | undefined): number =>
  v === undefined || !Number.isFinite(v) ? SPEED.default : Math.min(SPEED.max, Math.max(SPEED.min, Math.round(v * 100) / 100));

export const speakOf = (s: Pick<Settings, 'speak'>): SpeakSettings => s.speak ?? {};
export const speakOn = (s: Pick<Settings, 'speak'>): boolean => speakOf(s).enabled !== false;
// Those stored as profiles (an id and a name): anything else, written by hand or by a build that broke, is not one.
export const profilesOf = (s: Pick<Settings, 'speak'>): VoiceProfile[] => {
  const all = speakOf(s).profiles;
  return Array.isArray(all) ? all.filter((p) => typeof p?.id === 'string' && typeof p.name === 'string') : [];
};
// Without a profile, the system's own voice reads (speech/system-voice), unless it is switched off.
export const systemVoiceOn = (s: Pick<Settings, 'speak'>): boolean => speakOf(s).systemVoice !== false;
// Whether anything can be read: Speak on, with a profile, or the system voice.
export const canRead = (s: Pick<Settings, 'speak'>): boolean => speakOn(s) && (profilesOf(s).length > 0 || systemVoiceOn(s));
export const selectionButtonOn = (s: Pick<Settings, 'speak'>): boolean => canRead(s) && speakOf(s).selectionButton !== false;
// The button on each text box of an action's card: 'on'; 'setup' while there is nothing to read with (it
// says what to add); none when it is switched off, or Speak is.
export const actionBoxesButton = (s: Pick<Settings, 'speak'>): 'on' | 'setup' | undefined =>
  !speakOn(s) || speakOf(s).actionBoxesButton === false ? undefined : canRead(s) ? 'on' : 'setup';

// The default profile: the one chosen, else the first; none without profiles.
export function defaultProfile(s: Pick<Settings, 'speak'>): VoiceProfile | undefined {
  const all = profilesOf(s);
  return all.find((p) => p.id === speakOf(s).defaultProfileId) ?? all[0];
}
// The profile `id` names, else the default one (an agent's that was removed reads as none given).
export const profileOr = (s: Pick<Settings, 'speak'>, id: string | undefined): VoiceProfile | undefined =>
  (id ? profilesOf(s).find((p) => p.id === id) : undefined) ?? defaultProfile(s);

// What one request needs from a profile: its provider, model, voice and speed.
export interface SpeechTarget {
  provider: ProviderConfig;
  model: string;
  voice: string;
  speed: number;
}
// Why a profile cannot speak, or what it speaks with.
export function speechTarget(s: Pick<Settings, 'providers'>, p: VoiceProfile): SpeechTarget | { error: string } {
  const provider = s.providers.find((x) => x.id === p.providerId);
  if (!provider) return { error: `The voice profile "${p.name || 'unnamed'}" has no provider: choose one in Settings → Speak.` };
  const model = p.model?.trim();
  if (!model) return { error: `The voice profile "${p.name || 'unnamed'}" has no model: set one in Settings → Speak.` };
  const voice = p.voice?.trim();
  if (!voice) return { error: `The voice profile "${p.name || 'unnamed'}" has no voice: set one in Settings → Speak.` };
  return { provider, model, voice, speed: clampSpeed(p.speed) };
}

// Whose reading rules apply: the profile's that reads, else the one chosen in Settings → Speak, else the
// language set for dictation (Settings → Voice); 'none' at either step: none.
export function speakLanguage(s: Pick<Settings, 'speak' | 'voice'>, profile?: Pick<VoiceProfile, 'language'>): string | undefined {
  const own = typeof profile?.language === 'string' ? profile.language.trim() : '';
  const chosen = own || speakOf(s).language?.trim();
  if (chosen === 'none') return undefined;
  return chosen || s.voice?.language?.trim() || undefined;
}

// How a text is cut and said when `profile` reads it (its reading rules; the pieces' sizes and the pairs
// are Speak's own).
export const planOptions = (s: Pick<Settings, 'speak' | 'voice'>, profile?: Pick<VoiceProfile, 'language'>): PlanOptions => {
  const k = speakOf(s);
  return { first: clampSize(k.firstPiece, FIRST_PIECE), rest: clampSize(k.pieceSize, PIECE_SIZE), language: speakLanguage(s, profile), pairs: k.pairs ?? [] };
};

// The base URL of the provider a profile reads with, for a page to ask for its site inside the click.
export const providerUrlOf = (s: Pick<Settings, 'providers'>, p: VoiceProfile | undefined): string | undefined =>
  s.providers.find((x) => x.id === p?.providerId)?.baseURL;

// What an agent says of its voice (agents/profiles: its profile, its switch); none: Browser, whose own are
// in settings.browserAgent.
export interface AgentVoice {
  voiceProfileId?: string;
  canSpeak?: boolean;
}
export const agentVoiceOf = (s: Pick<Settings, 'browserAgent'>, agent: AgentVoice | undefined): AgentVoice => agent ?? s.browserAgent ?? {};
// Whether an agent is offered speech.say: its switch on (off by default), Speak on and a voice to read with.
export const speaksAloud = (s: Pick<Settings, 'speak' | 'browserAgent'>, agent: AgentVoice | undefined): boolean =>
  !!agentVoiceOf(s, agent).canSpeak && canRead(s);
