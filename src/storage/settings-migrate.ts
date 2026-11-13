// Stored settings as this version reads them: what earlier versions saved upgraded, and the
// "Environment" provider of a build with a key injected (EXTERNAL_MODEL_API_KEY).
import { isObject } from '../core/util';
import { DEFAULT_SYSTEM_PROMPT, type ProviderConfig, type Settings } from './settings-types';

// Defaults shipped by earlier (Spanish) versions, upgraded transparently.
const LEGACY_SYSTEM_PROMPT_PREFIX = 'Eres un asistente integrado en el navegador';
const LEGACY_ENV_NAME = 'Entorno (EXTERNAL_MODEL_API_KEY)';

// What is not an object, or a providers list or system prompt of another shape, is read as the default,
// never thrown on.
export function normalize(s: Partial<Settings> | undefined, injectedKey?: string): Settings {
  const merged: Settings = { providers: [], systemPrompt: DEFAULT_SYSTEM_PROMPT, ...(isObject(s) ? s : {}) };
  if (!Array.isArray(merged.providers)) merged.providers = [];
  if (typeof merged.systemPrompt !== 'string') merged.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  // Only OpenAI-compatible providers are supported; drop configs from older versions.
  merged.providers = merged.providers.filter((p) => isObject(p) && (p as { kind?: string }).kind !== 'anthropic');
  if (merged.systemPrompt.startsWith(LEGACY_SYSTEM_PROMPT_PREFIX)) merged.systemPrompt = DEFAULT_SYSTEM_PROMPT;
  // Earlier versions saved a Markdown on/off switch.
  const legacy = merged as Settings & { renderMarkdown?: boolean };
  if (legacy.renderMarkdown === false) merged.chatRender ??= 'plain';
  delete legacy.renderMarkdown;
  return withEnvProvider(merged, injectedKey);
}

export const ENV_PROVIDER_ID = 'env';

const injectedProvider = () => (typeof __ENV_PROVIDER__ !== 'undefined' ? __ENV_PROVIDER__ : null);
// Whether this build has a key injected (EXTERNAL_MODEL_API_KEY): then the "Environment" provider's
// key is that one, never stored nor edited.
export const envKeyInjected = () => Boolean(injectedProvider());
export const injectedBaseURL = () => injectedProvider()?.baseURL;

// Adds/updates the "Environment" provider with the key injected at build time (none yet: the worker
// has not kept it, background/env-key). The key always comes from the environment; URL and model
// edited by the user are kept.
function withEnvProvider(s: Settings, apiKey = ''): Settings {
  const injected = injectedProvider();
  if (!injected) return s;
  const existing = s.providers.find((p) => p.id === ENV_PROVIDER_ID);
  const merged: ProviderConfig = {
    ...existing,
    id: ENV_PROVIDER_ID,
    name: !existing?.name || existing.name === LEGACY_ENV_NAME ? 'Environment (EXTERNAL_MODEL_API_KEY)' : existing.name,
    baseURL: existing?.baseURL || injected.baseURL,
    defaultModel: existing?.defaultModel || injected.defaultModel,
    apiKey,
  };
  return {
    ...s,
    providers: existing ? s.providers.map((p) => (p.id === ENV_PROVIDER_ID ? merged : p)) : [merged, ...s.providers],
    activeProviderId: s.activeProviderId ?? ENV_PROVIDER_ID,
  };
}
