// What the playground and the previews remember of a text (ui/usePreviewMeaning): a partial answer, while
// the index is still going, would otherwise stay until the page reloads.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MeaningMatch } from '../src/memory/items';
import type { MemoryItem } from '../src/memory/store';
import type { Settings } from '../src/storage/settings';

const query = vi.hoisted(() => vi.fn());
vi.mock('wxt/browser', async () => (await import('./fakes/browser')).inertBrowser());
vi.mock('../src/memory/query-meaning', () => ({ queryMeaning: query }));
const { previewMeaning, rememberedMeaning } = await import('../src/ui/usePreviewMeaning');

const provider = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
const settings = { providers: [provider], memory: { semantic: { enabled: true, providerId: 'p1', model: 'embed' } } } as unknown as Settings;
const item = (id: string) => ({ id, enabled: true, text: id, pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1 }) as MemoryItem;
const both = [item('m-a'), item('m-b')];
const scores = (...ids: string[]): { meaning: MeaningMatch } => ({ meaning: { threshold: 55, scores: new Map(ids.map((id) => [id, 0.5])) } });

beforeEach(() => query.mockReset());

describe('previewMeaning', () => {
  it('remembers an answer for every item, asking only once', async () => {
    query.mockResolvedValue(scores('m-a', 'm-b'));
    await previewMeaning(settings, 'all scored', both);
    await previewMeaning(settings, 'all scored', both);
    expect(query).toHaveBeenCalledTimes(1);
    expect(rememberedMeaning(settings, 'all scored', both)).toBeDefined();
  });

  it('does not remember one with items still to index', async () => {
    query.mockResolvedValue(scores('m-a'));
    const { meaning } = await previewMeaning(settings, 'part scored', both);
    expect(meaning?.scores.size).toBe(1);
    expect(rememberedMeaning(settings, 'part scored', both)).toBeUndefined();
    await previewMeaning(settings, 'part scored', both);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
