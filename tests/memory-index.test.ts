// Keeping the vectors current (memory/indexer), against a mocked embeddings endpoint: what is sent, what
// is not, and that a failure or a dead worker loses nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';
import type { MemoryItem } from '../src/memory/store';
import type { VectorRecord } from '../src/memory/vector-db';
import type { Settings } from '../src/storage/settings';

const state = vi.hoisted(() => ({ vectors: new Map<string, unknown>(), access: true, blacklist: undefined as unknown }));
const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
vi.mock('../src/memory/vector-db', () => ({
  readVectors: async () => [...state.vectors.values()],
  writeVectors: async (records: { itemId: string }[]) => records.forEach((r) => state.vectors.set(r.itemId, r)),
  deleteVectors: async (ids: string[]) => ids.forEach((id) => state.vectors.delete(id)),
}));
vi.mock('../src/page/access', async (original) => ({ ...(await original<object>()), hasAccess: async () => state.access }));
vi.mock('../src/word-blacklist/store', () => ({ loadBlacklist: async () => state.blacklist }));

const { indexInputsChanged, indexRunner, MEMORY_INDEX_BATCH, MEMORY_INDEX_STATUS_KEY, MEMORY_INDEX_TIMEOUT_MS, syncMemoryIndex } = await import('../src/memory/indexer');

const provider = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
const settings = (over: object = {}) => ({ providers: [provider], memory: { semantic: { enabled: true, providerId: 'p1', model: 'embed', ...over } } }) as unknown as Settings;
const item = (id: string, change: Partial<MemoryItem> = {}): MemoryItem =>
  ({ id, enabled: true, text: `Rule ${id}`, pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1, ...change }) as MemoryItem;
const many = (n: number) => Array.from({ length: n }, (_, i) => item(`m-${i}`));

// Answers each text with a vector, as a server would.
const server = () =>
  vi.fn(async (_url: string, init: RequestInit) => {
    const { input } = JSON.parse(init.body as string) as { input: string[] };
    return new Response(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [1, 2] })) }));
  });
const sentTexts = (fetch: ReturnType<typeof server>) => fetch.mock.calls.flatMap(([, init]) => (JSON.parse(init.body as string) as { input: string[] }).input);

let fetch: ReturnType<typeof server>;
beforeEach(() => {
  state.vectors.clear();
  state.access = true;
  state.blacklist = undefined;
  storage.reset();
  fetch = server();
  vi.stubGlobal('fetch', fetch);
});
afterEach(() => vi.unstubAllGlobals());

describe('syncMemoryIndex', () => {
  it('embeds in batches of 32, saving each', async () => {
    expect(MEMORY_INDEX_BATCH).toBe(32);
    const status = await syncMemoryIndex(settings(), many(70));
    expect(fetch).toHaveBeenCalledTimes(3);
    expect(status).toEqual({ indexed: 70, total: 70 });
    expect((state.vectors.get('m-0') as VectorRecord)).toMatchObject({ providerId: 'p1', model: 'embed', dimensions: 2 });
    expect((state.vectors.get('m-0') as VectorRecord).vector).toBeInstanceOf(Float32Array);
  });

  it('sends nothing the second time', async () => {
    await syncMemoryIndex(settings(), many(3));
    fetch.mockClear();
    expect(await syncMemoryIndex(settings(), many(3))).toEqual({ indexed: 3, total: 3 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends only an edited item again', async () => {
    await syncMemoryIndex(settings(), many(3));
    fetch.mockClear();
    await syncMemoryIndex(settings(), [item('m-0', { text: 'Changed' }), item('m-1'), item('m-2')]);
    expect(sentTexts(fetch)).toEqual(['Changed']);
  });

  it('keeps what it finished when a batch fails, and sends only the rest next time', async () => {
    fetch.mockImplementationOnce(server()).mockImplementationOnce(async () => new Response('{}', { status: 500 }));
    const status = await syncMemoryIndex(settings(), many(40));
    expect(status).toMatchObject({ indexed: 32, total: 40, error: expect.stringContaining('500') });
    fetch.mockClear();
    expect(await syncMemoryIndex(settings(), many(40))).toEqual({ indexed: 40, total: 40 });
    expect(sentTexts(fetch)).toHaveLength(8);
  });

  it('never sends pinned or disabled items, nor counts them', async () => {
    const status = await syncMemoryIndex(settings(), [item('m-a'), item('m-pin', { pinned: true }), item('m-off', { enabled: false })]);
    expect(sentTexts(fetch)).toEqual(['Rule m-a']);
    expect(status).toEqual({ indexed: 1, total: 1 });
  });

  it('indexes an item once it is unpinned', async () => {
    await syncMemoryIndex(settings(), [item('m-a', { pinned: true })]);
    expect(fetch).not.toHaveBeenCalled();
    await syncMemoryIndex(settings(), [item('m-a')]);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  describe('while off', () => {
    it('sends nothing, and keeps the vectors', async () => {
      await syncMemoryIndex(settings(), many(2));
      fetch.mockClear();
      await syncMemoryIndex(settings({ enabled: false }), []);
      expect(fetch).not.toHaveBeenCalled();
      expect(state.vectors.size).toBe(2);
    });

    it('stops before the next batch when told to', async () => {
      let batches = 0;
      await syncMemoryIndex(settings(), many(70), () => batches++ < 1);
      expect(fetch).toHaveBeenCalledTimes(1);
    });
  });

  it('embeds again with another model, or another document prefix', async () => {
    await syncMemoryIndex(settings(), many(1));
    fetch.mockClear();
    await syncMemoryIndex(settings({ model: 'other' }), many(1));
    expect(fetch).toHaveBeenCalledTimes(1);
    fetch.mockClear();
    await syncMemoryIndex(settings({ model: 'other', documentPrefix: 'passage: ' }), many(1));
    expect(sentTexts(fetch)).toEqual(['passage: Rule m-0']);
  });

  it('embeds again when Test found other dimensions for the same model', async () => {
    await syncMemoryIndex(settings({ dimensions: 2 }), many(1));
    fetch.mockClear();
    await syncMemoryIndex(settings({ dimensions: 2 }), many(1));
    expect(fetch).not.toHaveBeenCalled();
    await syncMemoryIndex(settings({ dimensions: 3 }), many(1));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('keeps to the length the model gives when it is not the one Test found, and says so', async () => {
    const first = await syncMemoryIndex(settings({ dimensions: 3 }), many(40));
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first).toMatchObject({ indexed: 40, total: 40, error: expect.stringContaining('2 dimensions, not the 3') });
    expect(storage.local.data[MEMORY_INDEX_STATUS_KEY]).toMatchObject({ error: expect.stringContaining('run Test again') });
    fetch.mockClear();
    expect(await syncMemoryIndex(settings({ dimensions: 3 }), many(40))).toMatchObject({ indexed: 40, total: 40 });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('embeds again for another server, but not a vector an older build stored without one', async () => {
    await syncMemoryIndex(settings(), many(2));
    (state.vectors.get('m-1') as Partial<VectorRecord>).endpoint = undefined;
    fetch.mockClear();
    expect(await syncMemoryIndex(settings(), many(2))).toEqual({ indexed: 2, total: 2 });
    expect(fetch).not.toHaveBeenCalled();
    expect((state.vectors.get('m-1') as VectorRecord).endpoint).toBe((state.vectors.get('m-0') as VectorRecord).endpoint);
    provider.baseURL = 'https://other.example.com/v1';
    try {
      await syncMemoryIndex(settings(), many(2));
    } finally {
      provider.baseURL = 'https://llm.example.com/v1';
    }
    expect(sentTexts(fetch)).toEqual(['Rule m-0', 'Rule m-1']);
  });

  it('gives up on a request that never ends, and says so', async () => {
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(AbortSignal.abort(new DOMException('timed out', 'TimeoutError')));
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => {
      if (init.signal!.aborted) reject(init.signal!.reason);
      init.signal!.addEventListener('abort', () => reject(init.signal!.reason));
    })));
    const status = await syncMemoryIndex(settings(), many(1));
    expect(timeout).toHaveBeenCalledWith(MEMORY_INDEX_TIMEOUT_MS);
    expect(MEMORY_INDEX_TIMEOUT_MS).toBeLessThan(30_000); // a worker is ended past 30 seconds on one fetch
    expect(status).toMatchObject({ indexed: 0, total: 1, error: 'The provider did not answer in time.' });
    timeout.mockRestore();
  });

  it('does not with another query prefix', async () => {
    await syncMemoryIndex(settings(), many(1));
    fetch.mockClear();
    await syncMemoryIndex(settings({ queryPrefix: 'query: ' }), many(1));
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends masked text, and again when the terms change', async () => {
    state.blacklist = { config: {}, blacklist: { mask: (s: string) => s.replaceAll('Acme', 'CompanyX') } };
    await syncMemoryIndex(settings(), [item('m-a', { text: 'Call Acme now' })]);
    expect(sentTexts(fetch)).toEqual(['Call CompanyX now']);
    fetch.mockClear();
    state.blacklist = { config: {}, blacklist: { mask: (s: string) => s.replaceAll('Acme', 'CompanyY') } };
    await syncMemoryIndex(settings(), [item('m-a', { text: 'Call Acme now' })]);
    expect(sentTexts(fetch)).toEqual(['Call CompanyY now']);
  });

  it('prunes the vectors of deleted items', async () => {
    await syncMemoryIndex(settings(), many(2));
    await syncMemoryIndex(settings(), [item('m-0')]);
    expect([...state.vectors.keys()]).toEqual(['m-0']);
  });

  it('says why without access to the host, sending nothing', async () => {
    state.access = false;
    expect(await syncMemoryIndex(settings(), many(1))).toMatchObject({ indexed: 0, total: 1, error: expect.stringContaining('llm.example.com') });
    expect(fetch).not.toHaveBeenCalled();
  });

  it('keeps the status where Settings reads it', async () => {
    await syncMemoryIndex(settings(), many(2));
    expect(storage.local.data[MEMORY_INDEX_STATUS_KEY]).toEqual({ indexed: 2, total: 2 });
  });
});

describe('indexInputsChanged', () => {
  const stored = (semantic: object, over: object = {}) => ({ providers: [provider], systemPrompt: 'Be brief.', memory: { semantic: { enabled: true, providerId: 'p1', model: 'embed', ...semantic } }, ...over });

  it('is false for settings that change nothing the index depends on', () => {
    expect(indexInputsChanged(stored({}), stored({}, { systemPrompt: 'Be kind.' }))).toBe(false);
    expect(indexInputsChanged(stored({}), stored({ threshold: 70 }))).toBe(false);
    expect(indexInputsChanged(stored({}), stored({ queryPrefix: 'query: ' }))).toBe(false);
  });

  it('is true for what it does depend on', () => {
    expect(indexInputsChanged(stored({ enabled: false }), stored({}))).toBe(true);
    expect(indexInputsChanged(stored({}), stored({ model: 'other' }))).toBe(true);
    expect(indexInputsChanged(stored({}), stored({ documentPrefix: 'passage: ' }))).toBe(true);
    expect(indexInputsChanged(stored({}), stored({ dimensions: 3 }))).toBe(true);
    expect(indexInputsChanged(stored({}), stored({}, { providers: [{ ...provider, baseURL: 'https://other.example.com/v1' }] }))).toBe(true);
    expect(indexInputsChanged(stored({}), stored({}, { memory: { enabled: false } }))).toBe(true);
  });

  it('is true with nothing before', () => {
    expect(indexInputsChanged(undefined, stored({}))).toBe(true);
  });
});

describe('indexRunner', () => {
  it('runs once more after a trigger that came while running, not twice', async () => {
    const finish: (() => void)[] = [];
    const work = vi.fn(() => new Promise<void>((resolve) => finish.push(resolve)));
    const trigger = indexRunner(work);
    trigger();
    trigger();
    trigger();
    expect(work).toHaveBeenCalledTimes(1);
    finish[0]!();
    await vi.waitFor(() => expect(work).toHaveBeenCalledTimes(2));
    finish[1]!();
    await new Promise((r) => setTimeout(r));
    expect(work).toHaveBeenCalledTimes(2);
  });

  it('tells the running one to stop when another trigger comes', async () => {
    const finish: (() => void)[] = [];
    let keepGoing = () => true;
    const trigger = indexRunner((k) => ((keepGoing = k), new Promise<void>((resolve) => finish.push(resolve))));
    trigger();
    expect(keepGoing()).toBe(true);
    trigger();
    expect(keepGoing()).toBe(false);
    finish[0]!();
    await vi.waitFor(() => expect(finish).toHaveLength(2));
    finish[1]!();
  });

  it('runs again after a run that failed', async () => {
    const work = vi.fn(async () => {
      throw new Error('boom');
    });
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const trigger = indexRunner(work);
    trigger();
    await new Promise((r) => setTimeout(r));
    trigger();
    expect(work).toHaveBeenCalledTimes(2);
    error.mockRestore();
    await new Promise((r) => setTimeout(r));
  });
});
