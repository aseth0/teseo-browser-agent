// The models the pickers offer: a provider's registered ones (Settings → Providers → Models in the
// picker) or, with none registered, all those its server lists; and the models last picked, listed first
// in the chat's model picker.
import { modelKey } from '../core/util';
import type { ProviderConfig, Settings } from '../storage/settings';

export const RECENT_MODELS = 5; // how many recent models are kept

// The models a provider's picker lists: its default first, then those registered or, with none, those its
// server lists (`listed`; none while they load or when it cannot list them), and `selected` (the model
// chosen, of this provider) wherever it is. `all`: those listed even with some registered, and those
// registered that it does not list.
export function pickerModels(p: Pick<ProviderConfig, 'defaultModel' | 'models'>, listed: string[] = [], { all = false, selected }: { all?: boolean; selected?: string } = {}): string[] {
  const registered = p.models ?? [];
  const shown = !registered.length ? listed : all ? [...registered, ...listed] : registered;
  return [...new Set([...(p.defaultModel ? [p.defaultModel] : []), ...shown, ...(selected ? [selected] : [])])];
}

// Whether Show all would list more than a provider's registered models: some it lists are not registered.
export function listsMore(p: Pick<ProviderConfig, 'models'>, listed: string[]): boolean {
  if (!p.models?.length) return false;
  const registered = new Set(p.models);
  return listed.some((m) => !registered.has(m));
}

// How many models of a provider are registered, of how many its server lists (`listed`; none while
// they load or when it cannot list them): "3 of 214 registered", those it no longer lists left out.
export function registeredCount(p: Pick<ProviderConfig, 'models'>, listed: string[] | undefined): string {
  const models = p.models ?? [];
  if (!listed) return `${models.length} registered`;
  const there = new Set(listed);
  return `${models.filter((m) => there.has(m)).length} of ${listed.length} registered`;
}

// The recent models kept, those of the right shape (a list of strings; anything else, none).
const keptRecent = (recent: unknown): string[] => (Array.isArray(recent) ? recent.filter((k): k is string => typeof k === 'string') : []);

// The recent models with this one first, each once, at most RECENT_MODELS; the same list when it is first already.
export function withRecent(recent: string[] | undefined, providerId: string, model: string): string[] {
  const key = modelKey(providerId, model);
  const kept = keptRecent(recent);
  if (Array.isArray(recent) && kept.length === recent.length && recent.length <= RECENT_MODELS && recent[0] === key) return recent;
  return [key, ...kept.filter((k) => k !== key)].slice(0, RECENT_MODELS);
}

// The settings with a model picked: first of the recent ones and, with `chat`, the chat's model; the same
// settings when that changes nothing (nothing is then saved).
export function withPicked<S extends Pick<Settings, 'activeProviderId' | 'activeModel' | 'recentModels'>>(s: S, providerId: string, model: string, { chat }: { chat: boolean }): S {
  const recentModels = withRecent(s.recentModels, providerId, model);
  const sameChat = !chat || (s.activeProviderId === providerId && s.activeModel === model);
  if (sameChat && recentModels === s.recentModels) return s;
  return { ...s, ...(chat && { activeProviderId: providerId, activeModel: model }), recentModels };
}

// The recent models of the providers still set up, latest first (a model id may hold "|": the provider's
// id is what comes before the first one).
export function recentModels(recent: string[] | undefined, providers: Pick<ProviderConfig, 'id'>[]): { providerId: string; model: string }[] {
  const ids = new Set(providers.map((p) => p.id));
  return keptRecent(recent).flatMap((key) => {
    const at = key.indexOf('|');
    const providerId = key.slice(0, Math.max(at, 0));
    const model = key.slice(at + 1);
    return at > 0 && model && ids.has(providerId) ? [{ providerId, model }] : [];
  });
}

// A model registered or not: added at the end, or taken out. None left: the provider lists all again.
export function toggleRegistered(models: string[] | undefined, model: string): string[] | undefined {
  const now = models ?? [];
  const next = now.includes(model) ? now.filter((m) => m !== model) : [...now, model];
  return next.length ? next : undefined;
}
