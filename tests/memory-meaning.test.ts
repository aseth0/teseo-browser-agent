// An item passes by its words or by its meaning, each at its own threshold, and the block it goes in says
// which (memory/items withMeaning, memory/prompt, context/site-context).
import { describe, expect, it } from 'vitest';
import { autoPicks } from '../src/storage/auto-picks';
import { siteContextItems, type SiteContextInput } from '../src/context/site-context';
import { memoryMatchOf } from '../src/context/sources';
import { appendContext } from '../src/core/messages';
import { memoryMatches, withMeaning, type MeaningMatch } from '../src/memory/items';
import { memoryAutoItems, memoryPicks, memorySiteItems } from '../src/memory/prompt';
import type { MemoryItem } from '../src/memory/store';
import type { Message } from '../src/core/types';
import type { Settings } from '../src/storage/settings';

const item = (id: string, text: string, change: Partial<MemoryItem> = {}): MemoryItem =>
  ({ id, enabled: true, text, pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1, ...change }) as MemoryItem;
const meaningOf = (scores: Record<string, number>, threshold = 55): MeaningMatch => ({ scores: new Map(Object.entries(scores)), threshold });
const auto = { enabled: true, threshold: 60, max: 3 };
const asked = 'tracking codes';
const noWords = 'money back please'; // in none of the items
const words = item('m-words', 'Tracking codes are on the account page');
const close = item('m-close', 'Returns need the order number');
const far = item('m-far', 'Invoice address');
const items = [words, close, far];
const sentWith = (blocks: { kind: string; source?: string; text: string }[]): Message[] => appendContext([{ role: 'user', parts: [{ type: 'text', text: asked }] }], blocks as never);

describe('autoPicks', () => {
  const ranked = [{ id: 'a', match: 0.2, close: true }, { id: 'b', match: 0.2, close: false }];
  it('stays as it was without alsoPasses', () => {
    expect(autoPicks(ranked, auto, { threshold: 60, max: 2, most: 3 })).toEqual([]);
  });
  it('lets through what alsoPasses says, under the match needed', () => {
    expect(autoPicks(ranked, auto, { threshold: 60, max: 2, most: 3 }, () => true, (r) => r.close).map((r) => r.id)).toEqual(['a']);
  });
});

describe('withMeaning', () => {
  it('leaves the ranking as it is without meaning', () => {
    const ranked = memoryMatches(items, asked);
    expect(withMeaning(ranked, items, undefined)).toBe(ranked);
  });
  it('adds those only their meaning finds, each once, with both scores', () => {
    const ranked = withMeaning(memoryMatches(items, asked), items, meaningOf({ 'm-close': 0.71, 'm-words': 0.44 }));
    expect(ranked.map((r) => r.item.id).sort()).toEqual(['m-close', 'm-words']);
    expect(ranked.find((r) => r.item.id === 'm-close')).toMatchObject({ match: 0, meaning: 0.71 });
    expect(ranked.find((r) => r.item.id === 'm-words')).toMatchObject({ meaning: 0.44 });
  });
});

describe('auto-attach, by words or by meaning', () => {
  it('sends an item only its meaning reaches in the block that says so', () => {
    const [block, ...rest] = memoryAutoItems(items, noWords, [], auto, 'message', meaningOf({ 'm-close': 0.71 }));
    expect(rest).toEqual([]);
    expect(block!.text).toContain('Returns need the order number');
    expect(block!.text).toContain('They were matched by meaning');
    expect(block!.text).not.toContain('by their words');
  });

  it('sends one that reaches both as matched by its words', () => {
    const [block, ...rest] = memoryAutoItems(items, asked, [], auto, 'message', meaningOf({ 'm-words': 0.9 }));
    expect(rest).toEqual([]);
    expect(block!.text).toContain('matched by their words');
  });

  it('gives two blocks, words first, with the maximum across both', () => {
    const blocks = memoryAutoItems(items, asked, [], auto, 'message', meaningOf({ 'm-close': 0.71 }));
    expect(blocks.map((b) => (b.text.includes('by meaning') ? 'meaning' : 'words'))).toEqual(['words', 'meaning']);
    const one = memoryAutoItems(items, asked, [], { ...auto, max: 1 }, 'message', meaningOf({ 'm-close': 0.71, 'm-far': 0.7 }));
    expect(one.flatMap((b) => b.text.split('\n').filter((l) => l.includes('m-')))).toHaveLength(1);
  });

  it('counts for the chat as what a message matched, in both blocks', () => {
    const blocks = memoryAutoItems(items, asked, [], auto, 'message', meaningOf({ 'm-close': 0.71 }));
    for (const b of blocks) expect(memoryMatchOf(b.source)?.origin).toBe('message');
    expect(blocks.flatMap((b) => memoryMatchOf(b.source)!.titles)).toEqual([expect.stringContaining('Tracking'), expect.stringContaining('Returns')]);
  });

  it('does not send again what went by its meaning, until it is edited', () => {
    const meaning = meaningOf({ 'm-close': 0.71 });
    const history = sentWith(memoryAutoItems(items, asked, [], auto, 'message', meaning));
    expect(memoryAutoItems(items, asked, history, auto, 'message', meaning)).toEqual([]);
    const edited = items.map((m) => (m.id === 'm-close' ? { ...m, text: 'Returns need the receipt' } : m));
    expect(memoryAutoItems(edited, asked, history, auto, 'message', meaning).at(-1)!.text).toContain('Returns need the receipt');
  });

  it('never uses meaning between the steps', () => {
    const blocks = memoryAutoItems(items, noWords, [], auto, 'step', meaningOf({ 'm-close': 0.99 }));
    expect(blocks).toEqual([]);
  });

  it('leaves pinned and site items out, whatever their meaning', () => {
    const all = [item('m-pin', 'Pinned rule', { pinned: true }), item('m-site', 'Site rule', { domains: ['shop.example.test'] })];
    expect(memoryAutoItems(all, asked, [], auto, 'message', meaningOf({ 'm-pin': 0.99, 'm-site': 0.99 }))).toEqual([]);
  });

  it('picks by meaning in the playground as in the chat', () => {
    const meaning = meaningOf({ 'm-close': 0.71 });
    const ranked = withMeaning(memoryMatches(items, noWords), items, meaning);
    expect(memoryPicks(ranked, [], auto, meaning).map((r) => r.item.id)).toEqual(['m-close']);
  });

  it('treats a score at the threshold as reaching it', () => {
    expect(memoryAutoItems(items, noWords, [], auto, 'message', meaningOf({ 'm-far': 0.55 }))).toHaveLength(1);
    expect(memoryAutoItems(items, noWords, [], auto, 'message', meaningOf({ 'm-far': 0.54 }))).toEqual([]);
  });
});

describe('the items of the open site', () => {
  const host = 'shop.example.test';
  const onSite = [item('m-a', 'Refund form lives under help', { domains: [host] }), item('m-b', 'Opening hours', { domains: [host] })];
  const match = { typed: 'money back', threshold: 60 };

  it('sends whole one only its meaning reaches, the rest by title', () => {
    const blocks = memorySiteItems(onSite, host, [], { ...match, meaning: meaningOf({ 'm-a': 0.7, 'm-b': 0.1 }) });
    expect(blocks[0]!.text).toContain('Refund form lives under help');
    expect(blocks[0]!.text).not.toContain('Opening hours');
    expect(blocks[1]!.text).toContain('Opening hours');
  });

  it('goes as before without meaning', () => {
    const blocks = memorySiteItems(onSite, host, [], match);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.text).toContain('memory_index');
  });
});

describe('siteContextItems', () => {
  const input = (over: Partial<SiteContextInput>, settings: object = {}): SiteContextInput => ({
    settings: { providers: [{ id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' }], systemPrompt: '', memory: { autoAttach: auto, semantic: { enabled: true, providerId: 'p1', model: 'embed' } }, ...settings } as unknown as Settings,
    skills: [],
    templates: [],
    memory: items,
    memoryOpts: { reads: true, saves: true },
    url: 'https://other.example.test/',
    typed: noWords,
    history: [],
    ...over,
  });
  const meaning = meaningOf({ 'm-close': 0.71 });

  it('uses the meaning given', () => {
    expect(siteContextItems(input({ meaning })).items.at(-1)?.text).toContain('by meaning');
  });

  it('leaves it unused when this conversation left it out', () => {
    expect(siteContextItems(input({ meaning, skip: ['memoryMeaning'] })).items).toEqual([]);
  });

  it('leaves it unused with Semantic search off', () => {
    const off = { memory: { autoAttach: auto } };
    expect(siteContextItems(input({ meaning }, off)).items).toEqual([]);
  });
});
