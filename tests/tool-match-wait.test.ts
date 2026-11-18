// How long a message waits on tool matching (tools/match-turn) before its request, in a conversation's
// second message, with Semantic search on and an embeddings endpoint that never answers: at most the 2
// seconds of the query, never for ever, even when the vectors database never answers. The default mode
// waits on nothing.
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';

const state = vi.hoisted(() => ({ readHangs: false, records: [] as unknown[] }));
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
vi.mock('../src/memory/vector-db', () => ({
  vectorDb: () => ({ read: () => (state.readHangs ? new Promise(() => undefined) : Promise.resolve(state.records)), write: async () => undefined, delete: async () => undefined }),
  readVectors: async () => [],
}));
vi.mock('../src/page/access', () => ({ hasAccess: async () => true }));
vi.mock('../src/word-blacklist/store', () => ({ loadBlacklist: async () => undefined }));

const { turnToolMatch } = await import('../src/tools/match-turn');
const { matchGroups } = await import('../src/tools/match');
const { toolDocs } = await import('../src/tools/tool-index');
const { semanticTarget } = await import('../src/memory/semantic');
type Message = import('../src/core/types').Message;

const provider = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
const settings = (mode?: string) => ({ providers: [provider], tools: { match: mode && { mode } }, memory: { semantic: { enabled: true, providerId: 'p1', model: 'embed' } } }) as unknown as Settings;
const tools = [{ name: 'web.search', description: 'Searches the web.', source: 'web' as const }, { name: 'bookmarks.search', description: 'Searches bookmarks.', source: 'bookmarks' as const }];
const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });
// Never answers; gives up only when the request is aborted, as a real fetch does.
const silent = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new Error('aborted')))));

// The tools indexed already: the message's own vector is what is waited for.
state.records = (await toolDocs(matchGroups(tools), semanticTarget(settings('matching'))!)).map((d) => ({ itemId: d.name, providerId: 'p1', model: 'embed', dimensions: 2, hash: d.hash, vector: new Float32Array([1, 0]) }));

const timed = async (history: Message[], s: Settings, meaningOn = vi.fn(async () => true)) => {
  const at = Date.now();
  const r = await turnToolMatch({ settings: s, tools, history, mentioned: [], onDemand: [], meaningOn, turn: {} });
  return { r, ms: Date.now() - at };
};

describe('a second message with tool matching', () => {
  it('waits at most the query’s 2 seconds when the embeddings provider never answers', async () => {
    vi.stubGlobal('fetch', silent);
    const first = await timed([user('search the web')], settings('matching'));
    const history = [user('search the web'), { role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] } as Message, { ...user('and the bookmarks'), toolMatch: first.r.match }];
    const second = await timed(history, settings('matching'));
    expect(second.r.failed).toBe(true);
    expect(second.ms).toBeLessThan(2500);
    vi.unstubAllGlobals();
  }, 10_000);

  it('waits on nothing in the default mode', async () => {
    vi.stubGlobal('fetch', silent);
    silent.mockClear();
    const meaningOn = vi.fn(async () => true);
    const { ms } = await timed([user('a'), user('search the web')], settings(), meaningOn);
    expect(ms).toBeLessThan(50);
    expect(silent).not.toHaveBeenCalled();
    expect(meaningOn).not.toHaveBeenCalled(); // not even the conversation's choice is read
    vi.unstubAllGlobals();
  });

  it('goes by words after the 2 seconds when the vectors database never answers', async () => {
    vi.stubGlobal('fetch', silent);
    state.readHangs = true;
    const { r, ms } = await timed([user('search the web')], settings('matching'));
    state.readHangs = false;
    expect(r.failed).toBe(true);
    expect(r.match?.byWords).toBe(true);
    expect(ms).toBeLessThan(2500);
    vi.unstubAllGlobals();
  }, 10_000);

  it('sends nothing for tools not indexed yet, goes by words, and asks for them to be indexed', async () => {
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const kept = state.records;
    state.records = [];
    const { r, ms } = await timed([user('search the web')], settings('matching'));
    state.records = kept;
    expect(fetch).not.toHaveBeenCalled();
    expect(ms).toBeLessThan(50);
    expect(r.failed).toBeUndefined();
    expect(r.toIndex?.map((g) => g.id).sort()).toEqual(['bookmarks', 'web']);
    expect(r.match?.groups.find((g) => g.id === 'web')?.outcome).toBe('matched'); // by words
    vi.unstubAllGlobals();
  });
});
