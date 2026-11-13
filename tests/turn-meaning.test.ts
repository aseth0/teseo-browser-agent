// A message and matching by meaning (context/turn): it waits for the vector, it goes without one, and it
// sends nothing for a conversation that left it out, whatever the panel says.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import { documentText, textHash } from '../src/memory/semantic';
import type { MemoryItem } from '../src/memory/store';
import type { Settings } from '../src/storage/settings';

const state = vi.hoisted(() => ({ records: [] as unknown[], off: false, access: true }));
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).inertBrowser());
vi.mock('../src/memory/vector-db', () => ({ readVectors: async () => state.records }));
vi.mock('../src/page/access', async (original) => ({ ...(await original<object>()), hasAccess: async () => state.access }));
vi.mock('../src/word-blacklist/store', () => ({ loadBlacklist: async () => undefined }));
vi.mock('../src/context/meaning-off', () => ({ meaningOffFor: async () => state.off }));

const { turnContext } = await import('../src/context/turn');
const { MEANING_FAILED_NOTICE } = await import('../src/memory/query-meaning');

const provider = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
const settings = { providers: [provider], systemPrompt: '', memory: { autoAttach: { enabled: true }, semantic: { enabled: true, providerId: 'p1', model: 'embed' } } } as unknown as Settings;
const item = { id: 'm-a', enabled: true, text: 'Returns need the order number', pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1 } as MemoryItem;
const history: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'money back please' }] }];

const run = (over: { skip?: never[] | ['memoryMeaning'] } = {}) => {
  const send = vi.fn();
  const requestAccess = vi.fn(async () => false);
  return turnContext(
    { history, url: 'https://other.example.test/', includePage: false, conversationId: 'c1', skip: over.skip },
    { settings, skills: [], templates: [], memory: [item], memoryOpts: { reads: true, saves: true }, toolNames: [], requestAccess, send },
  ).then(({ items }) => ({ items, send, requestAccess }));
};

beforeEach(async () => {
  state.records = [{ itemId: 'm-a', providerId: 'p1', model: 'embed', dimensions: 2, hash: await textHash(documentText(item, undefined, (s) => s)), vector: new Float32Array([1, 0]) }];
  state.off = false;
  state.access = true;
});
afterEach(() => vi.unstubAllGlobals());

describe('a message', () => {
  it('attaches what is close in meaning, its words not reaching', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }))));
    const { items, send } = await run();
    expect(items.some((i) => i.text.includes('They were matched by meaning'))).toBe(true);
    expect(send).not.toHaveBeenCalled();
  });

  it('goes by words only, with a notice, when the provider fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 500 })));
    const { items, send } = await run();
    expect(items.some((i) => i.text.includes('by meaning'))).toBe(false);
    expect(send).toHaveBeenCalledWith({ type: 'notice', text: MEANING_FAILED_NOTICE });
    expect(MEANING_FAILED_NOTICE).toBe('Matched by words only: the embeddings provider did not answer.');
  });

  it('never asks for the host of the embeddings provider, it tells', async () => {
    state.access = false;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { send, requestAccess } = await run();
    expect(fetch).not.toHaveBeenCalled();
    expect(requestAccess).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledWith({ type: 'notice', text: MEANING_FAILED_NOTICE });
  });
});

describe('a conversation that left it out', () => {
  it('sends nothing, from the menu', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { send } = await run({ skip: ['memoryMeaning'] });
    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('sends nothing either when the panel just opened and has not read the choice yet', async () => {
    state.off = true;
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const { send } = await run({ skip: [] });
    expect(fetch).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
});
