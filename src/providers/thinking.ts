// "Thinking" (reasoning) settings on OpenAI-compatible servers. There is no single standard:
// each provider is configured with the parameter it understands, and Auto picks by URL.
// Pure, so the options page can show the same request body.
import type { ThinkingLevel } from '../core/types';

export type { ThinkingLevel };
export type ThinkingParam = 'auto' | 'reasoning_effort' | 'openrouter' | 'enable_thinking' | 'none';

export const THINKING_PARAMS: { value: ThinkingParam; label: string }[] = [
  { value: 'auto', label: 'Auto (OpenRouter by URL, otherwise reasoning_effort)' },
  { value: 'reasoning_effort', label: 'reasoning_effort — OpenAI, LiteLLM, Groq, Ollama, LM Studio' },
  { value: 'openrouter', label: 'reasoning: { effort } — OpenRouter' },
  { value: 'enable_thinking', label: 'chat_template_kwargs.enable_thinking — vLLM, SGLang (on/off only)' },
  { value: 'none', label: 'None — do not send a thinking setting' },
];

export function resolveThinkingParam(param: ThinkingParam | undefined, baseURL: string): Exclude<ThinkingParam, 'auto'> {
  if (param && param !== 'auto') return param;
  return /openrouter\.ai/i.test(baseURL) ? 'openrouter' : 'reasoning_effort';
}

// The levels a parameter can express ('enable_thinking' is only on or off).
export function thinkingLevels(param: Exclude<ThinkingParam, 'auto'>): ThinkingLevel[] {
  if (param === 'none') return [];
  return param === 'enable_thinking' ? ['off', 'high'] : ['off', 'low', 'medium', 'high'];
}

// Request body fields for a level.
export function thinkingBody(param: Exclude<ThinkingParam, 'auto'>, level: ThinkingLevel): Record<string, unknown> {
  switch (param) {
    case 'reasoning_effort':
      return { reasoning_effort: level === 'off' ? 'none' : level };
    case 'openrouter':
      return { reasoning: level === 'off' ? { enabled: false } : { effort: level } };
    case 'enable_thinking':
      return { chat_template_kwargs: { enable_thinking: level !== 'off' } };
    case 'none':
      return {};
  }
}

// Whether an error names a request field, as a field: not inside a model's name or path
// (qwen3-thinking, org/reasoning, model:thinking).
export const namesField = (text: string, field: string) => new RegExp(`(?<![\\w./:-])${field}(?![\\w-])`, 'i').test(text);

// A 400 that names the field of the thinking setting sent (`sent`, as thinkingBody made it): the
// model does not take it, so the request goes without. Its nested names count where they are not
// plain words (enable_thinking, not effort).
export function thinkingRejected(text: string, sent: Record<string, unknown>): boolean {
  const names = Object.entries(sent).flatMap(([k, v]) => [k, ...(v && typeof v === 'object' ? Object.keys(v).filter((n) => n.includes('_')) : [])]);
  return names.some((n) => namesField(text, n));
}
