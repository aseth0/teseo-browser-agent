// The request for embeddings (providers/embeddings): what it sends, and what it refuses of the answer;
// and which of a provider's models look like embeddings.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { embedTexts, rankEmbeddingModels } from '../src/providers/embeddings';

const cfg = { baseURL: 'https://llm.example.com/v1/', apiKey: 'test-key' };

const answer = (body: unknown, status = 200) => vi.fn(async (_url: string, _init: RequestInit) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));
const vectors = (...list: number[][]) => ({ data: list.map((embedding, index) => ({ index, embedding })) });

afterEach(() => vi.unstubAllGlobals());

describe('embedTexts', () => {
  it('posts the model and the texts to {baseURL}/embeddings', async () => {
    const fetch = answer(vectors([1, 2]));
    vi.stubGlobal('fetch', fetch);
    await embedTexts(cfg, 'embed-model', ['hello']);
    const [url, init] = fetch.mock.calls[0]!;
    expect(url).toBe('https://llm.example.com/v1/embeddings');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({ model: 'embed-model', input: ['hello'] });
  });

  it('sends the key and the extra headers, never the extra body', async () => {
    const fetch = answer(vectors([1]));
    vi.stubGlobal('fetch', fetch);
    await embedTexts({ ...cfg, extraHeaders: { 'api-key': '{{apiKey}}' }, extraBody: { reasoning_effort: 'high' } } as never, 'm', ['a']);
    const init = fetch.mock.calls[0]![1];
    expect((init.headers as Record<string, string>)['api-key']).toBe('test-key');
    expect(init.body as string).not.toContain('reasoning_effort');
  });

  it('gives the vectors in the order of the texts, whatever order the server answers in', async () => {
    vi.stubGlobal('fetch', answer({ data: [{ index: 1, embedding: [2, 2] }, { index: 0, embedding: [1, 1] }] }));
    expect(await embedTexts(cfg, 'm', ['a', 'b'])).toEqual([[1, 1], [2, 2]]);
  });

  it.each<[string, () => ReturnType<typeof answer>]>([
    ['an error status', () => answer('{"error":"nope"}', 500)],
    ['a body that is not JSON', () => answer('<html>Bad gateway</html>')],
    ['no list of vectors', () => answer({ ok: true })],
    ['fewer vectors than texts', () => answer(vectors([1, 2]))],
    ['something else than numbers', () => answer(vectors([1, 2], [1, 'x' as never]))],
    ['an empty vector', () => answer(vectors([1, 2], []))],
    ['vectors of different lengths', () => answer(vectors([1, 2], [1, 2, 3]))],
  ])('refuses %s', async (_name, make) => {
    vi.stubGlobal('fetch', make());
    await expect(embedTexts(cfg, 'm', ['a', 'b'])).rejects.toThrow();
  });

  it('passes the signal on, so a caller can give up', async () => {
    const fetch = answer(vectors([1]));
    vi.stubGlobal('fetch', fetch);
    const { signal } = new AbortController();
    await embedTexts(cfg, 'm', ['a'], signal);
    expect(fetch.mock.calls[0]![1].signal).toBe(signal);
  });
});

describe('rankEmbeddingModels', () => {
  it('lists the embeddings looking ones first, each group in its order', () => {
    expect(rankEmbeddingModels(['gpt-4o', 'text-embedding-3-small', 'llama3', 'bge-m3'])).toEqual(['text-embedding-3-small', 'bge-m3', 'gpt-4o', 'llama3']);
  });

  it.each([
    'text-embedding-3-large', 'mistral-embed', 'Qwen3-Embedding-4B', 'embeddinggemma', 'mxbai-embed-large:latest', 'nomic-embed-text',
    'bge-m3:latest', 'BAAI/bge-small-en-v1.5', 'multilingual-e5-large', 'intfloat/e5-small-v2', 'all-MiniLM-L6-v2', 'all-mpnet-base-v2', 'thenlper/gte-large', 'nomic-v1.5',
  ])('takes %s for one', (id) => {
    expect(rankEmbeddingModels(['chat', id])).toEqual([id, 'chat']);
  });

  // Short family names count only whole, and a reranker of such a family cannot embed.
  it.each(['economic-7b', 'subgen-1', 'cambridge-e50', 'phone5', 'bridge-gtest', 'bge-reranker-v2-m3', 'jina-rerank-embed'])('does not take %s for one', (id) => {
    expect(rankEmbeddingModels([id, 'mistral-embed'])).toEqual(['mistral-embed', id]);
  });

  it('leaves out nothing, and an empty list empty', () => {
    expect(rankEmbeddingModels(['b', 'a'])).toEqual(['b', 'a']);
    expect(rankEmbeddingModels([])).toEqual([]);
  });
});
