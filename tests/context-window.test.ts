import { afterEach, describe, expect, it, vi } from 'vitest';
import { mockFetch } from './fakes/browser';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { contextLimitFromError, pickContextWindow } = await import('../src/context/window');
const { OpenAICompatProvider } = await import('../src/providers/openai-compat');
const { ollamaWindow } = await import('../src/providers/context-window');

describe('a model\'s context window', () => {
  it('is read from the "too long" errors of each server family', () => {
    expect(contextLimitFromError("chat 400: This model's maximum context length is 128000 tokens. However, you requested 130211 tokens")).toBe(128000);
    expect(contextLimitFromError('chat 400: prompt is too long: 210000 tokens > 200000 maximum')).toBe(200000);
    expect(contextLimitFromError('chat 400: The input token count (1200000) exceeds the maximum number of tokens allowed (1048576).')).toBe(1048576);
    expect(contextLimitFromError('ContextWindowExceededError: maximum context length is 8,192 tokens')).toBe(8192);
    expect(contextLimitFromError('chat 500: upstream exploded')).toBeUndefined();
  });

  it('goes by what is surest: yours for the model, the error, the server, the provider, the model\'s most', () => {
    const all = { model: 1, learned: 2, found: { tokens: 3, source: 'server' as const }, provider: 4 };
    expect(pickContextWindow(all)).toEqual({ tokens: 1, source: 'model-settings' });
    expect(pickContextWindow({ ...all, model: undefined })).toEqual({ tokens: 2, source: 'error' });
    expect(pickContextWindow({ found: all.found, provider: 4 })).toEqual({ tokens: 3, source: 'server' });
    expect(pickContextWindow({ found: { tokens: 5, source: 'model-max' }, provider: 4 })).toEqual({ tokens: 4, source: 'settings' });
    expect(pickContextWindow({ found: { tokens: 5, source: 'model-max' } })).toEqual({ tokens: 5, source: 'model-max' });
    expect(pickContextWindow({})).toEqual({ source: 'unknown' });
  });

  it('from Ollama: its num_ctx, else the most the model takes', () => {
    expect(ollamaWindow({ parameters: 'stop "<eos>"\nnum_ctx 8192', model_info: { 'gemma3.context_length': 131072 } })).toEqual({ tokens: 8192, source: 'server' });
    expect(ollamaWindow({ parameters: '', model_info: { 'gemma3.context_length': 131072 } })).toEqual({ tokens: 131072, source: 'model-max' });
    expect(ollamaWindow({})).toBeUndefined();
  });
});

describe('asking the server for it', () => {
  afterEach(() => vi.unstubAllGlobals());
  const provider = () => new OpenAICompatProvider({ baseURL: 'http://gateway.test/v1', apiKey: 'k' });

  it('takes what /models published, without asking more', async () => {
    const fetch = mockFetch(new Response(''));
    expect(await provider().contextWindow('m', [{ id: 'm', contextWindow: 32768 }])).toEqual({ tokens: 32768, source: 'server' });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('else a LiteLLM gateway\'s /model/info, then Ollama\'s /api/show', async () => {
    const urls: string[] = [];
    mockFetch(async (url: string) => {
      urls.push(url);
      if (url.endsWith('/model/info')) return Response.json({ data: [{ model_name: 'other', model_info: { max_input_tokens: 1 } }, { model_name: 'm', model_info: { max_input_tokens: 200000 } }] });
      return new Response('', { status: 404 });
    });
    expect(await provider().contextWindow('m', [{ id: 'm' }])).toEqual({ tokens: 200000, source: 'server' });
    mockFetch(async (url: string) => {
      urls.push(url);
      return url.endsWith('/api/show') ? Response.json({ parameters: 'num_ctx 4096' }) : new Response('', { status: 404 });
    });
    expect(await provider().contextWindow('m', [{ id: 'm' }])).toEqual({ tokens: 4096, source: 'server' });
    expect(urls).toEqual(['http://gateway.test/v1/model/info', 'http://gateway.test/v1/model/info', 'http://gateway.test/api/show']);
  });
});
