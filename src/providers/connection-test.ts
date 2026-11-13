// "Test connection" diagnostics: permission → /models → minimal chat, with readable errors.
import type { LLMProvider } from '../core/types';
import { errorText } from '../core/errors';

export function humanizeError(e: unknown, baseURL: string): string {
  const msg = errorText(e);
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) {
    return `Could not connect to ${baseURL} (DNS, VPN, untrusted certificate or server down). Open it in a tab to check.`;
  }
  if (/\b401\b|\b403\b/.test(msg)) return `${msg} → check the API key or the auth header (Extra headers).`;
  if (/\b404\b/.test(msg)) return `${msg} → check the Base URL (missing or extra /v1?).`;
  return msg;
}

const CHAT_TEST_MS = 30_000; // the test chat request, without /models

export async function testConnection(provider: LLMProvider, model: string): Promise<string> {
  let modelsError: unknown;
  try {
    const models = await provider.listModels();
    if (models.length) return `OK · ${models.length} models`;
  } catch (e) {
    modelsError = e;
  }
  if (!model) {
    throw modelsError ?? new Error('The server does not list models: set a "Default model" to test the chat.');
  }
  // Many self-hosted servers do not implement /models: try the chat directly.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CHAT_TEST_MS);
  try {
    const stream = provider.chat({ model, messages: [{ role: 'user', parts: [{ type: 'text', text: 'ping' }] }], maxTokens: 16 }, ctrl.signal);
    for await (const _ of stream) {
      // it is enough for the stream to finish without errors
    }
    return `OK · chat with ${model}${modelsError ? ' (no /models)' : ''}`;
  } finally {
    clearTimeout(timer);
  }
}
