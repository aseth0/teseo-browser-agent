// Origin marks: while marking, every value that fills a placeholder is wrapped in private-use
// characters so a view can color where text comes from: from the web (the page block, site
// templates, site skill values, page tool results) or from the extension (your message, skills,
// other values). The preview builds its examples inside withMarkedValues(); the background marks
// the real conversation (setValueMarking) for the side panel's Layers view, and toOpenAIMessages
// strips the marks from what is sent to the model. Each origin has its own pair; "page" and
// "extension" keep the first ones, so conversations saved before still read the same.
export const MARKS = {
  page: ['\uE000', '\uE001'],
  extension: ['\uE002', '\uE003'],
  template: ['\uE004', '\uE005'],
  skillValues: ['\uE006', '\uE007'],
  tool: ['\uE008', '\uE009'],
  message: ['\uE00A', '\uE00B'],
  skill: ['\uE00C', '\uE00D'],
  mcp: ['\uE010', '\uE011'], // after the cut notes' pair (\uE00E, \uE00F)
  history: ['\uE012', '\uE013'],
  memory: ['\uE014', '\uE015'],
} as const;
export type Origin = keyof typeof MARKS;
// Written while marking, before the cut's own text for the model ("…[truncated]"); the detail
// says which limit and how much (core/limits cutDetail).
const CUT = ['\uE00E', '\uE00F'] as const;
// The character classes below come from these pairs: a new origin needs no other change.
const MARK_CHARS = Object.values(MARKS).flat().join('');
const ANY_MARK = new RegExp(`[${MARK_CHARS}]`);
const CUT_NOTE = `${CUT[0]}[^${CUT[1]}]*${CUT[1]}`;
const OPENS = new Map(Object.entries(MARKS).map(([origin, [open]]) => [open as string, origin as Origin]));
const CLOSES = new Set<string>(Object.values(MARKS).map(([, close]) => close));
let marking = false;

export function setValueMarking(on: boolean): void {
  marking = on;
}

export function withMarkedValues<T>(build: () => T): T {
  const was = marking;
  marking = true;
  try {
    return build();
  } finally {
    marking = was;
  }
}

// The origins whose values come from the web (pages, servers, saved conversations that quote them):
// what they write cannot close or open an untrusted block.
const WEB_ORIGINS = new Set<Origin>(['page', 'template', 'skillValues', 'mcp', 'history', 'tool']);

// A "<untrusted_…" or "</untrusted_…" tag in web content, with its < made fullwidth: the text stays
// readable, but it is no longer the tag the model is told to trust as the block's boundary. Also with
// spaces or invisible characters (zero-width, soft hyphen) around the "/", which the model may read past.
const GAP = '[\\s\\u00AD\\u180E\\u200B-\\u200F\\u2060-\\u2064\\uFEFF]*';
const UNTRUSTED_TAG = new RegExp(`<(?=${GAP}(?:\\/${GAP})?untrusted_)`, 'gi');
export const neutralizeTags = (s: string) => s.replace(UNTRUSTED_TAG, '＜');

// A value made of other marked parts (e.g. a list of marked items) is left as it is.
export const markValue = (value: string, origin: Origin = 'extension') => {
  const s = WEB_ORIGINS.has(origin) ? neutralizeTags(value) : value;
  return marking && s && !ANY_MARK.test(s) ? MARKS[origin][0] + s + MARKS[origin][1] : s;
};

// Data read from a page, with every string in it marked with its origin (the page block by
// default) and its untrusted tags neutralized. Mark characters the page itself contains are
// dropped first, so a page cannot fake where its text comes from.
export function markPageData<T>(data: T, origin: Origin = 'page'): T {
  const mark = (v: unknown): unknown => {
    if (typeof v === 'string') return markValue(stripMarks(v), origin);
    if (Array.isArray(v)) return v.map(mark);
    if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, mark(x)]));
    return v;
  };
  return mark(data) as T;
}

// Where something was cut to a size limit: a note for the views (Layers, the chat), never sent.
const CUT_NOTES = new RegExp(`${CUT[0]}([^${CUT[1]}]*)${CUT[1]}`, 'g');
export const cutNote = (detail: string) => (marking ? CUT[0] + detail + CUT[1] : '');
export const cutsIn = (s: string) => [...s.matchAll(CUT_NOTES)].map((m) => m[1]!);

// Without origin marks and cut notes (and any stray mark character a page may contain).
const STRAY_MARKS = new RegExp(`[${MARK_CHARS}${CUT.join('')}]`, 'g');
export const stripMarks = (s: string) => s.replace(CUT_NOTES, '').replace(STRAY_MARKS, '');

const MARK_RUNS = new RegExp(`(${CUT_NOTE}|[${MARK_CHARS}])`);

// Splits marked text into runs with their origin (the innermost mark wins). The stack carries
// open marks across calls, for text split into several nodes; a value cut to fit may have lost
// its closing mark. A cut note is a run of its own, with no text and the note's detail.
export function originRuns(s: string, stack: Origin[] = []): { text: string; origin?: Origin; cut?: string }[] {
  const runs: { text: string; origin?: Origin; cut?: string }[] = [];
  for (const chunk of s.split(MARK_RUNS)) {
    const opens = OPENS.get(chunk);
    if (opens) stack.push(opens);
    else if (CLOSES.has(chunk)) stack.pop();
    else if (chunk.startsWith(CUT[0])) runs.push({ text: '', origin: stack.at(-1), cut: chunk.slice(1, -1) });
    else if (chunk) runs.push({ text: chunk, origin: stack.at(-1) });
  }
  return runs;
}
