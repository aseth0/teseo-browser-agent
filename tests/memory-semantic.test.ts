// What matching by meaning decides without talking to anyone (memory/semantic).
import { describe, expect, it } from 'vitest';
import { cosine, documentText, fuseRanks, indexable, isFresh, MEANING_THRESHOLD, semanticTarget, textHash } from '../src/memory/semantic';
import type { MemoryItem } from '../src/memory/store';
import type { Settings } from '../src/storage/settings';

const provider = { id: 'p1', name: 'Local', baseURL: 'https://llm.example.com/v1', apiKey: '', defaultModel: 'chat' };
const settings = (semantic: Record<string, unknown> | undefined, memory: Record<string, unknown> = {}) =>
  ({ providers: [provider], memory: { ...memory, semantic } }) as unknown as Settings;
const on = { enabled: true, providerId: 'p1', model: 'embed' };
const item = (change: Partial<MemoryItem> = {}): MemoryItem =>
  ({ id: 'm-1', enabled: true, text: 'Some text', pinned: false, domains: [], agents: [], source: 'user', createdAt: 1, updatedAt: 1, ...change }) as MemoryItem;

describe('semanticTarget', () => {
  it('gives the provider, the model and the threshold, 55 unless set', () => {
    expect(semanticTarget(settings(on))).toMatchObject({ provider: { id: 'p1' }, model: 'embed', threshold: MEANING_THRESHOLD });
    expect(MEANING_THRESHOLD).toBe(55);
    expect(semanticTarget(settings({ ...on, threshold: 70 }))?.threshold).toBe(70);
  });

  it.each<[string, Settings]>([
    ['no setting', settings(undefined)],
    ['the switch off', settings({ ...on, enabled: false })],
    ['memory off', settings(on, { enabled: false })],
    ['a provider that no longer exists', settings({ ...on, providerId: 'gone' })],
    ['a blank model', settings({ ...on, model: '  ' })],
  ])('is none with %s', (_name, s) => {
    expect(semanticTarget(s)).toBeUndefined();
  });
});

describe('indexable', () => {
  it('takes the items that can match by meaning, and only those', () => {
    expect(indexable(item())).toBe(true);
    expect(indexable(item({ pinned: true }))).toBe(false);
    expect(indexable(item({ enabled: false }))).toBe(false);
    expect(indexable(item({ text: '  ' }))).toBe(false);
  });
});

describe('documentText', () => {
  const same = (s: string) => s;

  it('is the title and the text, or the text alone', () => {
    expect(documentText(item({ title: 'A title' }), undefined, same)).toBe('A title\nSome text');
    expect(documentText(item(), undefined, same)).toBe('Some text');
  });

  it('puts the prefix first, and masks what the item says without it', () => {
    const mask = (s: string) => `masked(${s})`;
    expect(documentText(item(), 'passage: ', mask)).toBe('passage: masked(Some text)');
  });

  it('leaves out the marks of where a value came from', () => {
    expect(documentText(item({ text: 'Some \uE014text\uE015' }), undefined, same)).toBe('Some text');
  });
});

describe('textHash', () => {
  it('tells texts apart, and gives the same for the same', async () => {
    expect(await textHash('a')).toBe(await textHash('a'));
    expect(await textHash('a')).not.toBe(await textHash('b'));
  });
});

describe('isFresh', () => {
  const record = { itemId: 'm-1', providerId: 'p1', model: 'embed', dimensions: 2, hash: 'h', vector: new Float32Array([1, 0]) };
  const target = { providerId: 'p1', model: 'embed', endpoint: 'e1' };

  it('needs the same provider, model and text', () => {
    expect(isFresh(record, target, 'h')).toBe(true);
    expect(isFresh(record, { ...target, providerId: 'p2' }, 'h')).toBe(false);
    expect(isFresh(record, { ...target, model: 'other' }, 'h')).toBe(false);
    expect(isFresh(record, target, 'other')).toBe(false);
  });

  it('needs the same server, taking a record without one (an older build\'s) as this one\'s', () => {
    expect(isFresh({ ...record, endpoint: 'e1' }, target, 'h')).toBe(true);
    expect(isFresh({ ...record, endpoint: 'e2' }, target, 'h')).toBe(false);
  });

  it('needs the dimensions Test found, once it found some', () => {
    expect(isFresh(record, { ...target, dimensions: 2 }, 'h')).toBe(true);
    expect(isFresh(record, { ...target, dimensions: 3 }, 'h')).toBe(false);
  });
});

describe('cosine', () => {
  it('is 1 for the same direction, 0 for orthogonal', () => {
    expect(cosine([1, 2], [2, 4])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('is 0, never NaN, for a zero vector or different lengths', () => {
    expect(cosine([0, 0], [1, 1])).toBe(0);
    expect(cosine([1, 2, 3], [1, 2])).toBe(0);
  });
});

describe('fuseRanks', () => {
  it('prefers what is high in both orders over what is first in one', () => {
    expect(fuseRanks([['a', 'b'], ['c', 'b']])[0]).toBe('b');
  });

  it('takes what only one order has, each once', () => {
    expect(fuseRanks([['a'], ['b', 'a']]).sort()).toEqual(['a', 'b']);
  });

  it('keeps the first order on a tie', () => {
    expect(fuseRanks([['a', 'b'], ['b', 'a']])).toEqual(['a', 'b']);
  });
});
