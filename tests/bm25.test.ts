import { describe, expect, it } from 'vitest';
import type { Message } from '../src/core/types';
import { rank } from '../src/history/rank';
import { firstMatch, matchSpans, stem, terms } from '../src/search/bm25';
import type { Conversation } from '../src/history/store';

const conv = (id: string, title: string, history: Message[], updatedAt = 0): Conversation => ({ id, title, history, createdAt: 0, updatedAt, turns: 1 });
const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });
const answer = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
const page = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text: 'hi' }, { type: 'text', text, context: 'page' }] });

describe('BM25 over saved conversations', () => {
  it('indexes a conversation again once it changes (saved, pinned)', () => {
    const before = conv('same', 'Shopping', [user('a brass lamp')], 1);
    expect(rank('lamp', [before]).map((r) => r.conv.id)).toEqual(['same']);
    const after = conv('same', 'Shopping', [user('a brass lamp'), answer('the walnut desk')], 2);
    expect(rank('walnut', [after]).map((r) => r.conv.id)).toEqual(['same']);
    const thinking: Message = { role: 'assistant', parts: [{ type: 'reasoning', text: 'maybe a platypus' }, { type: 'text', text: 'ok' }] };
    const plain = conv('same', 'Shopping', [user('hi'), thinking], 3);
    expect(rank('platypus', [plain])).toEqual([]); // reasoning only counts once pinned
    expect(rank('platypus', [{ ...plain, pinned: true }]).map((r) => r.conv.id)).toEqual(['same']);
  });

  it('compares words without case, accents, plural endings or the commonest words', () => {
    expect(terms('Las Lámparas de LATÓN')).toEqual(['lampara', 'laton']);
    expect(stem('cables')).toBe(stem('cable'));
    expect(stem('ordenadores')).toBe(stem('ordenador'));
  });

  it('reads words in any alphabet, and cuts the scripts written without spaces', () => {
    expect(terms('Привет мир')).toEqual(['привет', 'мир']);
    expect(terms('Straße in Łódź, Øresund')).toEqual(['strass', 'lodz', 'oresund']);
    expect(terms('東京タワーに行く')).toEqual(['東京タワー', 'に', '行く']);
    expect(terms('e-mail iPhone 5')).toEqual(['mail', stem('iphone')]);
  });

  it('marks words of a script written without spaces where they are', () => {
    const text = 'Visit 東京タワー today';
    expect(matchSpans(text, '東京タワー').map(({ start, end }) => text.slice(start, end))).toEqual(['東京タワー']);
  });

  it('ranks the rare words higher, and does not need every word', () => {
    const convs = [
      conv('a', 'Cables', [user('cable cable cable'), answer('a cable')]),
      conv('b', 'USB', [user('which usb cable is cheapest'), answer('the usb-c one')]),
      conv('c', 'Lamps', [user('lámparas de latón')]),
    ];
    expect(rank('usb cable', convs).map((r) => r.conv.id)).toEqual(['b', 'a']);
    expect(rank('lampara', convs).map((r) => r.conv.id)).toEqual(['c']);
    expect(rank('the of', convs)).toEqual([]); // only common words
  });

  it('weighs the title over what was written, and page content least', () => {
    const inTitle = conv('title', 'Brass lamp', [user('hello')]);
    const inPage = conv('page', 'Shopping', [page('brass lamp brass lamp brass lamp')]);
    expect(rank('brass lamp', [inPage, inTitle]).map((r) => r.conv.id)).toEqual(['title', 'page']);
  });

  it('finds where the words first appear, for the snippet', () => {
    expect(firstMatch('We talked about Lámparas today', 'lampara')).toBe(16);
    expect(firstMatch('nothing here', 'lamp')).toBe(-1);
  });

  it('keeps only the conversations with a quoted phrase, as written (case and accents aside)', () => {
    const convs = [
      conv('exact', 'Shop', [user('¿Cuál es el Precio del cable USB?')]),
      conv('apart', 'Shop', [user('el cable cuesta poco; el precio sube')]),
    ];
    expect(rank('precio cable', convs).map((r) => r.conv.id).sort()).toEqual(['apart', 'exact']);
    expect(rank('"precio del cable"', convs).map((r) => r.conv.id)).toEqual(['exact']);
    expect(rank('"precio del cable" usb', convs).map((r) => r.conv.id)).toEqual(['exact']);
  });

  it('marks where a text matches: the phrase and each word', () => {
    const text = 'El Precio del cable baja';
    const pick = (q: string) => matchSpans(text, q).map((s) => text.slice(s.start, s.end));
    expect(pick('cables precio')).toEqual(['Precio', 'cable']);
    expect(pick('"precio del cable"')).toEqual(['Precio del cable', 'Precio', 'cable']);
  });

  it('finds the words a query word begins, while it is being typed, below the whole word', () => {
    const convs = [conv('whole', 'Animals', [user('orn is a word')]), conv('animal', 'Animals', [user('the ornithorhynchus lays eggs')])];
    expect(rank('ornithorhynchus', convs).map((r) => r.conv.id)).toEqual(['animal']);
    expect(rank('orn', convs, { prefix: true }).map((r) => r.conv.id)).toEqual(['whole', 'animal']); // the word itself first
    expect(rank('or', convs, { prefix: true })).toEqual([]); // too short to begin words
    expect(rank('orn', convs).map((r) => r.conv.id)).toEqual(['whole']); // whole words only without `prefix`
    const text = 'The ornithorhynchus';
    expect(matchSpans(text, 'orn', { prefix: true }).map((s) => text.slice(s.start, s.end))).toEqual(['ornithorhynchus']);
  });
});
