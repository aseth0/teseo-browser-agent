// Ranks documents for a search with BM25 (saved conversations, memory, bookmarks): the words that are
// rare across them weigh more, not every word must appear, and where a word is matters (a title more
// than the page content; the conversations' weights are in history/rank).
// Words are compared in lowercase, without accents, with plural endings dropped and without the
// commonest words of English and Spanish. Any alphabet is read (Cyrillic, Greek, Arabic…); a script
// written without spaces (Chinese, Japanese, Thai…) is cut into words by the browser's own
// Intl.Segmenter. It finds words, not meanings: no synonyms. Words in quotes
// ("price of the cable") must appear together, as written (case and accents aside). With `prefix`
// (the 🕘 search box), a word of 3 letters or more also finds the words it begins ("orn" →
// "ornithorhynchus"), weighing less; elsewhere (auto-attach, history.search) only whole words, so "pro"
// in a message does not find "programa".
import { stripMarks } from '../core/origin-marks';

const K1 = 1.2;
const B = 0.75;
const PREFIX_MIN = 3; // letters a word needs to find the words it begins
const PREFIX_WEIGHT = 0.7; // what such a find counts, against the word itself

// How often a document has a query word: the word itself, and the words it begins.
function frequency(freq: Map<string, number>, word: string, prefix: boolean): number {
  let f = freq.get(word) ?? 0;
  if (prefix && word.length >= PREFIX_MIN) for (const [t, n] of freq) if (t !== word && t.startsWith(word)) f += n * PREFIX_WEIGHT;
  return f;
}

// Whether a word of a text is one the query looks for.
const wantedBy = (wanted: Set<string>, prefix: boolean) => (term: string) =>
  wanted.has(term) || (prefix && [...wanted].some((w) => w.length >= PREFIX_MIN && term.startsWith(w)));

const STOPWORDS = new Set(
  (
    'a an and are as at be but by for from has have i in is it of on or that the this to was were what when where which who will with you your ' +
    'al como con de del el en es esta este esto la las lo los me mi mis para pero por que se si sin su sus te tu un una uno unos y ya'
  ).split(' '),
);

// "Lámparas" → "lampara", "cables" → "cabl" (and "cable" → "cabl").
export function stem(word: string): string {
  let w = word;
  if (w.length > 3 && w.endsWith('s')) w = w.slice(0, -1);
  if (w.length > 3 && w.endsWith('e')) w = w.slice(0, -1);
  return w;
}

// Latin letters NFD does not take apart ("ł" is no "l" with a mark): as their base letters.
const LETTERS: Record<string, string> = { ß: 'ss', ł: 'l', ø: 'o', đ: 'd', ħ: 'h', ı: 'i', æ: 'ae', œ: 'oe', þ: 'th' };
// Lowercase without accents (NFD, the Latin marks dropped, then NFC: the marks of other scripts are part of
// their letters, a kana's or a Hangul syllable's). It keeps the text's length but for ß, æ, œ and þ, so
// positions hold.
const unaccent = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .normalize('NFC')
    .replace(/[ßłøđħıæœþ]/g, (c) => LETTERS[c]!);

// A run of letters, digits and their marks, in any script.
const WORD = /[\p{L}\p{N}\p{M}]+/gu;
// Scripts written without spaces between words: a run of them is cut by Intl.Segmenter.
const UNSPACED = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}\p{Script=Lao}\p{Script=Khmer}\p{Script=Myanmar}]/u;
let segmenter: Intl.Segmenter | undefined;

// The words of a text, each with where it starts, as written.
function* words(text: string): Generator<{ word: string; index: number }> {
  const onlyLatin = !/[^\u0000-\u024f]/.test(text); // the usual text: nothing to cut, no run to test
  for (const m of text.matchAll(WORD)) {
    if (onlyLatin || !UNSPACED.test(m[0])) {
      yield { word: m[0], index: m.index };
      continue;
    }
    segmenter ??= new Intl.Segmenter(undefined, { granularity: 'word' });
    for (const s of segmenter.segment(m[0])) if (s.isWordLike) yield { word: s.segment, index: m.index + s.index };
  }
}

// A word (already unaccented) as it is compared, or none: one Latin letter or digit says too little ("e"
// of "e-mail"), one Chinese character does not.
function termOf(w: string): string | undefined {
  if ((w.length < 2 && w.charCodeAt(0) < 128) || STOPWORDS.has(w)) return undefined;
  return stem(w);
}

export function terms(text: string): string[] {
  const found: string[] = [];
  for (const { word } of words(unaccent(text))) {
    const t = termOf(word);
    if (t) found.push(t);
  }
  return found;
}

// What is searched of anything (a conversation, a memory item): its words, weighed by where they are.
export interface Indexed<T> {
  item: T;
  freq: Map<string, number>; // weighted term frequency
  length: number; // weighted number of terms
  plain: string; // all of it folded (lowercase, no accents, single spaces), for the quoted phrases
}

const fold = (s: string) => unaccent(s).replace(/\s+/g, ' ');

// The quoted phrases of a query, folded.
export const phrasesOf = (query: string) => [...query.matchAll(/"([^"]+)"/g)].map((m) => fold(m[1]!).trim()).filter(Boolean);

// Texts, each with its weight, as one searchable item.
export function indexTexts<T>(item: T, texts: [text: string, weight: number][]): Indexed<T> {
  const freq = new Map<string, number>();
  let length = 0;
  for (const [text, weight] of texts) {
    for (const t of terms(stripMarks(text))) {
      freq.set(t, (freq.get(t) ?? 0) + weight);
      length += weight;
    }
  }
  return { item, freq, length, plain: fold(stripMarks(texts.map(([t]) => t).join('\n'))) };
}

// How a search matches: with `prefix` (the 🕘 search box), a word also finds the words it begins;
// with `unseen` (auto-attach), the words no item has count against the match (scored).
export interface MatchOptions {
  prefix?: boolean;
  unseen?: number;
}

// The items with any of the query's words and all its quoted phrases, unsorted. How rare a word is
// comes from `corpus` (all the items, when only some are scored). `match` is the score from 0 to 1
// against having, once in an item of average length, every word of the query that some item of the
// corpus has: how much of what was asked it covers, its rare words weighing more (words no item has
// do not count against it). With `unseen` (0 to 1; tools/match), they do: each as that part of a word
// only one item has, so one shared word in a message of others no item knows is no full match.
export function scored<T>(query: string, docs: Indexed<T>[], { corpus = docs, prefix = false, unseen = 0 }: MatchOptions & { corpus?: Indexed<T>[]; unseen?: number } = {}): { item: T; score: number; match: number }[] {
  const words = [...new Set(terms(query))];
  if (!words.length) return [];
  const phrases = phrasesOf(query);
  const matching = docs.filter((d) => phrases.every((p) => d.plain.includes(p)));
  const all = corpus === docs ? matching : corpus;
  const avg = all.reduce((n, d) => n + d.length, 0) / Math.max(1, all.length);
  const idf = new Map(
    words.map((w) => {
      const n = all.filter((d) => frequency(d.freq, w, prefix) > 0).length;
      return [w, n ? Math.log(1 + (all.length - n + 0.5) / (n + 0.5)) : 0];
    }),
  );
  const rarest = Math.log(1 + (all.length - 0.5) / 1.5); // a word only one item has
  const full = words.reduce((sum, w) => sum + (idf.get(w) || unseen * rarest), 0); // each word once, at the average length
  return matching
    .map((d) => {
      const score = words.reduce((sum, w) => {
        const f = frequency(d.freq, w, prefix);
        return f ? sum + idf.get(w)! * ((f * (K1 + 1)) / (f + K1 * (1 - B + (B * d.length) / (avg || 1)))) : sum;
      }, 0);
      return { item: d.item, score, match: full ? Math.min(1, score / full) : 0 };
    })
    .filter((r) => r.score > 0);
}

// Where in a text the query matches: its quoted phrases and each of its words (a word's position
// and length in the text, first to last).
export function matchSpans(text: string, query: string, { prefix = false }: MatchOptions = {}): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const folded = unaccent(text);
  const sameLength = folded.length === text.length;
  for (const phrase of phrasesOf(query)) {
    const at = sameLength ? folded.indexOf(phrase) : -1;
    if (at >= 0) spans.push({ start: at, end: at + phrase.length });
  }
  const wanted = wantedBy(new Set(terms(query)), prefix);
  for (const { word, index } of words(text)) {
    const term = termOf(unaccent(word));
    if (term && wanted(term)) spans.push({ start: index, end: index + word.length });
  }
  return spans.sort((a, b) => a.start - b.start);
}

// Where in a text the query first matches, if it does.
export const firstMatch = (text: string, query: string, options?: MatchOptions) => matchSpans(text, query, options)[0]?.start ?? -1;
