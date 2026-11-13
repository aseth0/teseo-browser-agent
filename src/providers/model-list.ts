// The models a provider's server lists, asked once per page and endpoint (the chat's model picker,
// Settings → Providers' default model): not on every open. A failure is asked again next time.
import type { ModelInfo } from '../core/types';
import type { ProviderConfig } from '../storage/settings';
import { createProvider } from './registry';

// By provider and URL, with the key and headers they were asked with: asked again when those change.
const cache = new Map<string, { auth: string; models: Promise<ModelInfo[]> }>();

// `fresh`: asked again, what was kept left (a site permission just granted, a key just typed).
export function fetchModels(p: ProviderConfig, { fresh = false }: { fresh?: boolean } = {}): Promise<ModelInfo[]> {
  const key = `${p.id}|${p.baseURL}`;
  const auth = JSON.stringify([p.apiKey, p.extraHeaders ?? null]);
  const kept = cache.get(key);
  if (!fresh && kept?.auth === auth) return kept.models;
  const entry = { auth, models: createProvider(p).listModels() };
  // Asked again next time instead of keeping the failure (unless asked again already).
  entry.models.catch(() => cache.get(key) === entry && cache.delete(key));
  cache.set(key, entry);
  return entry.models;
}
