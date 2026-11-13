// From a message to how close each item is (memory/query-meaning), against a mocked embeddings endpoint.
// What it must never do: send when off, send unmasked, or let a failure reach the message.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { documentText, textHash } from '../src/memory/semantic';
import type { MemoryItem } from '../src/memory/store';
import type { VectorRecord } from '../src/memory/vector-db';
import type { Settings } from '../src/storage/settings';

const state = vi.hoisted(() => ({ records: [] as unknown[], access: true, blacklist: undefined as unknown }));
vi.mock('../src/memory/vector-db', () => ({ readVectors: async () => state.records }));
vi.mock('../src/page/access', () => ({ hasAccess: async () => state.access }));
vi.mock('../src/word-blacklist/store', () => ({
  loadBlacklist: async () => {
    if (state.blacklist === 'unreadable') throw new Error('no database');
    return state.blacklist;
  },
}));

const { meaningCandidates, QUERY_TIMEOUT_MS, queryMeaning } = await import('../src/memory/query-meaning');

const provider = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
const semantic = { enabled: true, providerId: 'p1', model: 'embed' };
const settings = (over: object = {}) => ({ providers: [provider], memory: { semantic: { ...semantic, ...over } } }) as unknown as Settings;
const item = (id: string, text: string, change: Partial<MemoryItem> = {}): MemoryItem =>
  ({ id, enabled: true, text, pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1, ...change }) as MemoryItem;
const same = (s: string) => s;
const record = async (m: MemoryItem, vector: number[], over: Partial<VectorRecord> = {}): Promise<VectorRecord> =>
  ({ itemId: m.id, providerId: 'p1', model: 'embed', dimensions: vector.length, hash: await textHash(documentText(m, undefined, same)), vector: new Float32Array(vector), ...over });
const answering = (vector: number[]) => vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify({ data: [{ index: 0, embedding: vector }] })));
const sent = (fetch: ReturnType<typeof answering>) => JSON.parse(fetch.mock.calls[0]![1].body as string) as { model: string; input: string[] };

const a = item('m-a', 'Returns need the order number');
const b = item('m-b', 'Invoice address');

beforeEach(async () => {
  state.records = [await record(a, [1, 0]), await record(b, [0, 1])];
  state.access = true;
  state.blacklist = undefined;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('queryMeaning', () => {
  it('scores the candidates against the message, with the threshold', async () => {
    vi.stubGlobal('fetch', answering([1, 0]));
    const { meaning, failed } = await queryMeaning(settings({ threshold: 70 }), 'money back', [a, b]);
    expect(failed).toBeFalsy();
    expect(meaning!.threshold).toBe(70);
    expect(meaning!.scores.get('m-a')).toBeCloseTo(1);
    expect(meaning!.scores.get('m-b')).toBeCloseTo(0);
  });

  it('never gives less than 0', async () => {
    vi.stubGlobal('fetch', answering([-1, 0]));
    const { meaning } = await queryMeaning(settings(), 'money back', [a]);
    expect(meaning!.scores.get('m-a')).toBe(0);
  });

  it('scores only the candidates: an item of another agent gets none', async () => {
    vi.stubGlobal('fetch', answering([1, 0]));
    const { meaning } = await queryMeaning(settings(), 'money back', [a]);
    expect([...meaning!.scores.keys()]).toEqual(['m-a']);
  });

  it('gives no score to an item edited since it was embedded', async () => {
    vi.stubGlobal('fetch', answering([1, 0]));
    const { meaning } = await queryMeaning(settings(), 'money back', [{ ...a, text: 'Returns need the receipt' }, b]);
    expect([...meaning!.scores.keys()]).toEqual(['m-b']);
  });

  it('gives no score to a vector of another model', async () => {
    state.records = [await record(a, [1, 0], { model: 'older' }), await record(b, [0, 1])];
    vi.stubGlobal('fetch', answering([1, 0]));
    const { meaning } = await queryMeaning(settings(), 'money back', [a, b]);
    expect([...meaning!.scores.keys()]).toEqual(['m-b']);
  });

  it('counts as not indexed a vector of other dimensions, beside others that fit', async () => {
    state.records = [await record(a, [1, 0, 0]), await record(b, [0, 1])];
    vi.stubGlobal('fetch', answering([0, 1]));
    const { meaning, failed } = await queryMeaning(settings(), 'money back', [a, b]);
    expect(failed).toBeFalsy();
    expect([...meaning!.scores.keys()]).toEqual(['m-b']);
  });

  it('counts as not indexed a vector of other dimensions than Test found', async () => {
    state.records = [await record(a, [1, 0, 0]), await record(b, [0, 1])];
    vi.stubGlobal('fetch', answering([0, 1]));
    const { meaning } = await queryMeaning(settings({ dimensions: 2 }), 'money back', [a, b]);
    expect([...meaning!.scores.keys()]).toEqual(['m-b']);
  });

  it('scores vectors of the length the model gives even when Test found another', async () => {
    vi.stubGlobal('fetch', answering([0, 1]));
    const { meaning } = await queryMeaning(settings({ dimensions: 3 }), 'money back', [a, b]);
    expect([...meaning!.scores.keys()]).toEqual(['m-a', 'm-b']);
  });

  it('never scores vectors from another server, but does those an older build stored without one', async () => {
    state.records = [await record(a, [1, 0], { endpoint: 'elsewhere' }), await record(b, [0, 1])];
    vi.stubGlobal('fetch', answering([0, 1]));
    const { meaning } = await queryMeaning(settings(), 'money back', [a, b]);
    expect([...meaning!.scores.keys()]).toEqual(['m-b']);
  });

  describe('sends nothing', () => {
    it.each<[string, () => Parameters<typeof queryMeaning>]>([
      ['with the switch off', () => [settings({ enabled: false }), 'money back', [a]]],
      ['with no provider left', () => [settings({ providerId: 'gone' }), 'money back', [a]]],
      ['with no text', () => [settings(), '  ', [a]]],
      ['with no candidates', () => [settings(), 'money back', []]],
    ])('%s', async (_name, args) => {
      const fetch = answering([1, 0]);
      vi.stubGlobal('fetch', fetch);
      expect(await queryMeaning(...args())).toEqual({});
      expect(fetch).not.toHaveBeenCalled();
    });

    it('while nothing is indexed, as there would be nothing to compare it with', async () => {
      state.records = [];
      const fetch = answering([1, 0]);
      vi.stubGlobal('fetch', fetch);
      expect(await queryMeaning(settings(), 'money back', [a])).toEqual({});
      expect(fetch).not.toHaveBeenCalled();
    });
  });

  it('masks the message, after the prefix, with the word blacklist on', async () => {
    const mask = (s: string) => s.replaceAll('Acme', 'CompanyX');
    state.blacklist = { config: {}, blacklist: { mask } };
    state.records = [await record(a, [1, 0], { hash: await textHash(documentText(a, undefined, mask)) })];
    const fetch = answering([1, 0]);
    vi.stubGlobal('fetch', fetch);
    await queryMeaning(settings({ queryPrefix: 'query: ' }), 'refund from Acme', [a]);
    expect(sent(fetch).input).toEqual(['query: refund from CompanyX']);
  });

  it('leaves out the marks of where a value came from', async () => {
    const fetch = answering([1, 0]);
    vi.stubGlobal('fetch', fetch);
    await queryMeaning(settings(), 'money back', [a]);
    expect(sent(fetch).input).toEqual(['money back']);
  });

  describe('fails without throwing, nothing to attach by meaning', () => {
    it.each<[string, () => typeof fetch]>([
      ['an error status', () => vi.fn(async () => new Response('{}', { status: 500 })) as never],
      ['an HTML page', () => vi.fn(async () => new Response('<html>Bad gateway</html>')) as never],
      ['the network down', () => vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as never],
      ['vectors as long as no record', () => answering([1, 0, 0]) as never],
    ])('on %s', async (_name, make) => {
      vi.stubGlobal('fetch', make());
      expect(await queryMeaning(settings(), 'money back', [a])).toEqual({ failed: true });
    });

    it('without access to the host, not even trying', async () => {
      state.access = false;
      const fetch = answering([1, 0]);
      vi.stubGlobal('fetch', fetch);
      expect(await queryMeaning(settings(), 'money back', [a])).toEqual({ failed: true });
      expect(fetch).not.toHaveBeenCalled();
    });

    it('when the server does not answer in time', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))));
      const result = queryMeaning(settings(), 'money back', [a]);
      await vi.advanceTimersByTimeAsync(QUERY_TIMEOUT_MS);
      expect(QUERY_TIMEOUT_MS).toBe(2000);
      expect(await result).toEqual({ failed: true });
    });
  });

  it('sends nothing unmasked when the blacklist cannot be read', async () => {
    const fetch = answering([1, 0]);
    vi.stubGlobal('fetch', fetch);
    state.blacklist = 'unreadable';
    expect(await queryMeaning(settings(), 'money back', [a])).toEqual({ failed: true });
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe('meaningCandidates', () => {
  const host = 'shop.example.test';
  const free = item('m-free', 'Any site');
  const pinned = item('m-pin', 'Pinned', { pinned: true });
  const onSite = item('m-site', 'This site', { domains: [host] });
  const elsewhere = item('m-other', 'Another site', { domains: ['other.example.test'] });
  const pinnedOnSite = item('m-sitepin', 'Pinned here', { domains: [host], pinned: true });
  const all = [free, pinned, onSite, elsewhere, pinnedOnSite];
  const allOn = () => true;
  const ids = (list: MemoryItem[]) => list.map((m) => m.id);

  it('takes what auto-attach and the open site could match, never what is pinned', () => {
    expect(ids(meaningCandidates(all, host, allOn, true))).toEqual(['m-free', 'm-site']);
  });
  it('leaves out the auto-attachable with auto-attach off', () => {
    expect(ids(meaningCandidates(all, host, (k) => k !== 'memoryAuto', true))).toEqual(['m-site']);
  });
  it('leaves out the site items of an agent that cannot read them, or with site matching off', () => {
    expect(ids(meaningCandidates(all, host, allOn, false))).toEqual(['m-free']);
    expect(ids(meaningCandidates(all, host, (k) => k !== 'memorySiteMatch', true))).toEqual(['m-free']);
    expect(ids(meaningCandidates(all, host, (k) => k !== 'memory', true))).toEqual(['m-free']);
  });
  it('is empty when nothing could match, so nothing goes', () => {
    expect(meaningCandidates([pinned], host, allOn, true)).toEqual([]);
  });
});
