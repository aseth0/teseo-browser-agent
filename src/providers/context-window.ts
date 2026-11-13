// A model's context window as servers publish it (providers/openai-compat contextWindow).
import type { FoundContextWindow } from '../core/types';

// Each server family publishes the context window under a different name.
export function contextWindowOf(m: Record<string, unknown>): number | undefined {
  for (const key of ['context_length', 'context_window', 'max_model_len', 'max_context_length', 'context_size']) {
    const v = m[key];
    if (typeof v === 'number' && v > 0) return v;
  }
  const top = m.top_provider as { context_length?: unknown } | undefined; // OpenRouter
  return typeof top?.context_length === 'number' ? top.context_length : undefined;
}

// Ollama's /api/show: the num_ctx the model is run with, when its Modelfile sets it; else the most
// its architecture takes ("<arch>.context_length"), which Ollama may run with less of.
export function ollamaWindow(shown: Record<string, unknown>): FoundContextWindow | undefined {
  const numCtx = Number(String(shown.parameters ?? '').match(/^num_ctx\s+(\d+)/m)?.[1]);
  if (numCtx > 0) return { tokens: numCtx, source: 'server' };
  const info = (shown.model_info ?? {}) as Record<string, unknown>;
  const most = Object.entries(info).find(([k, v]) => k.endsWith('.context_length') && typeof v === 'number' && v > 0)?.[1] as number | undefined;
  return most ? { tokens: most, source: 'model-max' } : undefined;
}
