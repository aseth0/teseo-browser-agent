// A model's context window, for the chat's meter and the runs: set for that model (in the meter),
// learned from a server that refused a request as too long, published by the server, set for its
// provider (Settings → Providers), or the most the model takes (Ollama without num_ctx), in that order.
import type { FoundContextWindow, WindowSource } from '../core/types';
import type { ProviderConfig, Settings } from '../storage/settings-types';
import { modelKey } from '../core/util';
import { compactionOf, compactionWindow } from './compaction';
import { modelMap } from './model-map';

const learned = modelMap('learnedContextWindows'); // storage.local: tokens, by model

// A model's context window and where it came from: set for the model, learned from a "too long" error,
// published by the server, set for the provider, or the model's most.
export type ContextWindow = { tokens?: number; source: 'model-settings' | 'error' | 'server' | 'settings' | 'model-max' | 'unknown' };

// The limit a server's "too long" error names: "maximum context length is 128000 tokens" (OpenAI,
// vLLM, LiteLLM), "210000 tokens > 200000 maximum" (Anthropic), "exceeds the maximum number of tokens
// allowed (1048576)" (Gemini), "context length of 8192" / "context window is 32768".
export function contextLimitFromError(message: string): number | undefined {
  const patterns = [
    /maximum context length is ([\d,]+)/i,
    /tokens\s*>\s*([\d,]+)\s*maximum/i,
    /maximum number of tokens allowed \(([\d,]+)\)/i,
    /context (?:length|window|size) (?:of|is) ([\d,]+)/i,
  ];
  for (const re of patterns) {
    const n = Number(message.match(re)?.[1]?.replace(/,/g, ''));
    if (n > 0) return n;
  }
  return undefined;
}

// What says a request was too long for the model's window, with or without the limit. A limit alone
// is not enough for the loosest of the patterns ("context length of 8192" can be said of max_tokens).
const OVERFLOW = /context[_ ]length[_ ]exceeded|(?:prompt|input|request|context) is too long|too many (?:input )?tokens|exceeds? the (?:model's )?(?:maximum )?context|exceed\w* (?:the |its |your )?(?:model's )?(?:maximum )?context (?:length|window|size)|reduce the length of the (?:messages|prompt)/i;
const STRICT_LIMIT = [/maximum context length is [\d,]+/i, /tokens\s*>\s*[\d,]+\s*maximum/i, /maximum number of tokens allowed \([\d,]+\)/i];

// Whether a server refused a request as longer than its model's window, said with or without the limit.
export function isContextOverflow(message: string): boolean {
  return STRICT_LIMIT.some((re) => re.test(message)) || OVERFLOW.test(message);
}

// The model's window from a server's error: only one that refused the request as too long, and says
// the limit (any other error that names a number teaches nothing).
export async function learnContextWindow(providerId: string, model: string, error: string): Promise<void> {
  if (!isContextOverflow(error)) return;
  const tokens = contextLimitFromError(error);
  if (tokens) await learned.change(providerId, model, () => tokens);
}

// A learned window smaller than what a call of the model's took (`input`, as its server reported) is
// stale: forgotten, so the server's or the provider's goes again.
export async function checkLearnedWindow(providerId: string, model: string, input: number): Promise<void> {
  const key = modelKey(providerId, model);
  const known = (await learned.all())[key];
  if (known && input > known) await learned.forget(key);
}

// Forgets the window learned for a model (Settings → Compaction → Learned), by its modelKey.
export const forgetContextWindow = (key: string) => learned.forget(key);

export const learnedContextWindows = learned.all;
export const onLearnedContextWindows = learned.onChanged;

// The window in force, from what is known of it.
export function pickContextWindow(known: { model?: number; learned?: number; found?: FoundContextWindow; provider?: number }): ContextWindow {
  if (known.model) return { tokens: known.model, source: 'model-settings' };
  if (known.learned) return { tokens: known.learned, source: 'error' };
  if (known.found?.source === 'server') return { tokens: known.found.tokens, source: 'server' };
  if (known.provider) return { tokens: known.provider, source: 'settings' };
  if (known.found) return { tokens: known.found.tokens, source: 'model-max' };
  return { source: 'unknown' };
}

// The window a run fits its requests in (agent loop's contextWindow), and where it comes from: the one
// the panel counted on for its model, else what is known of the model here (set for it, learned, set for
// its provider), else the one Settings → Compaction counts on for an unknown window (none when that is 0).
export type RunWindow = { tokens?: number; source: WindowSource };
export async function runWindow(settings: Settings, cfg: ProviderConfig, model: string, fromPanel?: { tokens?: number; source?: WindowSource }): Promise<RunWindow> {
  if (fromPanel?.tokens) return { tokens: fromPanel.tokens, source: fromPanel.source ?? 'settings' };
  const key = modelKey(cfg.id, model);
  const known = pickContextWindow({ model: settings.contextWindows?.[key], learned: (await learnedContextWindows())[key], provider: cfg.contextWindow });
  return windowInForce(known, compactionOf(settings.compaction));
}

// A known window as it is, else Settings → Compaction's for an unknown one ('default'; none when 0).
export function windowInForce(known: ContextWindow, cfg: ReturnType<typeof compactionOf>): RunWindow {
  if (known.tokens && known.source !== 'unknown') return { tokens: known.tokens, source: known.source };
  return { tokens: compactionWindow(undefined, cfg), source: 'default' };
}
