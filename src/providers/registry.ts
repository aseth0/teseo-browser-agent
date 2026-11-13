import type { LLMProvider } from '../core/types';
import type { ProviderConfig } from '../storage/settings';
import { OpenAICompatProvider } from './openai-compat';

// Every provider speaks the OpenAI-compatible /chat/completions API.
export function createProvider(cfg: ProviderConfig): LLMProvider {
  const { apiKey, baseURL, extraHeaders, extraBody, thinkingParam } = cfg;
  return new OpenAICompatProvider({ apiKey, baseURL, extraHeaders, extraBody, thinkingParam });
}
