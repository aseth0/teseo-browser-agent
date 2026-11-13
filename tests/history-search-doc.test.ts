import { describe, expect, it } from 'vitest';
import type { Message } from '../src/core/types';
import { rank, searchDocFor } from '../src/history/rank';
import { asSearchDoc, rankDocs, TERMS_MAX, termsOf } from '../src/history/search-doc';
import type { Conversation } from '../src/history/store';

const conv = (id: string, title: string, history: Message[], updatedAt = 0, pinned = false): Conversation => ({ id, title, history, createdAt: 0, updatedAt, turns: 1, ...(pinned && { pinned }) });
const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });
const answer = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
const page = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text: 'look' }, { type: 'text', text, context: 'page' }] });
const tool = (content: string): Message => ({ role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c', content }] });
const thought = (text: string, args: Record<string, unknown>): Message => ({ role: 'assistant', parts: [{ type: 'reasoning', text }, { type: 'tool_call', id: 'c', name: 'find', args }] });

const corpus: Conversation[] = [
  conv('lamps', 'Brass lamps', [user('a brass lamp for the desk'), answer('Three brass lamps under 40 €'), page('Lámparas de latón, envío gratis')], 5),
  conv('cables', 'USB-C cables', [user('the cheapest usb-c cable'), tool('Cable USB-C 2 m, 9 €; cable USB-A 1 m'), answer('The 2 m cable')], 4),
  conv('desk', 'Walnut desk', [user('a walnut desk and a lamp'), thought('maybe the platypus brand', { query: 'walnut desk ornithorhynchus' }), answer('This desk')], 3, true),
  conv('ties', 'Lamp shades', [user('lamp shades'), answer('linen lamp shades')], 3),
  conv('empty', 'Nothing', [user('hello')], 1),
  conv('jp', '東京の天気', [user('東京の天気は？'), answer('晴れです')], 2),
];

// The documents as stored and read back.
const docsOf = (convs: Conversation[]) => convs.map((c) => ({ item: c, doc: asSearchDoc(JSON.parse(JSON.stringify(searchDocFor(c))))! }));
const byConvs = (q: string, prefix = false) => rank(q, corpus, { prefix }).map(({ conv: c, score, match }) => ({ id: c.id, score, match }));
const byDocs = (q: string, prefix = false) => rankDocs(q, docsOf(corpus), { prefix }).map(({ item, score, match }) => ({ id: item.id, score, match }));

describe('history search documents', () => {
  it('rank as the conversations themselves do, scores and matches alike', () => {
    for (const q of ['lamp', 'brass lamp', 'usb cable', 'lampara laton', 'walnut', 'platypus', 'ornithorhynchus', 'desk lamp shades', '東京', 'nothing at all', 'the of'])
      for (const prefix of [false, true]) {
        const expected = byConvs(q, prefix);
        expect(byDocs(q, prefix), `${q} ${prefix}`).toEqual(expected);
      }
    expect(byConvs('orn', true).map((r) => r.id)).toEqual(['desk']); // prefixes too, from the documents
    expect(byDocs('orn', true).map((r) => r.id)).toEqual(['desk']);
    expect(byDocs('lamp').map((r) => r.id)).toEqual(['ties', 'lamps', 'desk']); // the short one first
  });

  it('keep the heaviest terms of a long conversation, and its whole length', () => {
    const words = Array.from({ length: TERMS_MAX + 50 }, (_, i) => `word${i.toString(36)}x`);
    const long = conv('long', 'Heavy title', [user('typed heavy'), page(words.join(' '))]);
    const full = searchDocFor(long);
    expect(termsOf(full)).toHaveLength(TERMS_MAX);
    expect(termsOf(full).slice(0, 2)).toEqual([['heavy', 5], ['titl', 3]]); // in their order; title 3 + typed 2
    expect(full.length).toBeCloseTo(3 + 3 + 2 + 2 + 2 + 0.3 * words.length); // every term counted, the dropped ones too
    expect(rankDocs('heavy', [{ item: long, doc: full }]).map((r) => r.item.id)).toEqual(['long']);
    expect(rankDocs(words.at(-1)!, [{ item: long, doc: full }])).toEqual([]); // past the cap: not found
    expect(rank(words.at(-1)!, [long])).toHaveLength(1); // as the whole conversation finds it
  });

  it('keep a weight as the tenths it is', () => {
    const doc = searchDocFor(conv('w', 'x', [page('lamp lamp lamp')])); // 0.3 three times
    expect(termsOf(doc).find(([t]) => t === 'lamp')).toEqual(['lamp', 0.9]);
    expect(doc.tenths.every(Number.isSafeInteger)).toBe(true);
  });

  it('read a document of another shape or format as none', () => {
    const good = searchDocFor(corpus[0]!);
    expect(asSearchDoc(good)).toEqual(good);
    expect(asSearchDoc({ ...good, terms: '', tenths: [] })).toBeDefined();
    for (const bad of [null, 'x', [], { ...good, v: 99 }, { ...good, version: 1 }, { ...good, length: 'x' }, { ...good, terms: ['a'] }, { ...good, tenths: 'x' }, { ...good, terms: 'a b', tenths: [1] }, { ...good, terms: 'a', tenths: [null] }, { ...good, terms: 'a', tenths: [0.5] }, { ...good, terms: '', tenths: [1] }])
      expect(asSearchDoc(bad)).toBeUndefined();
  });
});
