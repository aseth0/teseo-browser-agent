// The values that change between runs of a recording's calls (phase 2): what the model should make
// the tool's inputs, take from an earlier answer, or compute. Found in the calls ticked:
// - from an answer: a value an answer gave that a later call sends (an id, a key);
// - computed: a number a later call sends one more than an answer gave (a page's version);
// - a parameter: a value a call sends that no earlier answer gave (most likely typed or picked by the
//   user: the extension does not see the keys).
// Proposed with a name; the user renames them or changes their kind (Recording.vars), in the review's
// Make a tool step.
import { escapeRegExp } from '../core/util';
import { FORM_BODY, HIDDEN, jsonOfLine, multipartPairs, NAMED_PARTS, recordedCalls, type RecordedCall, type Recording } from './recording';

export type VariableKind = 'parameter' | 'answer' | 'computed' | 'fixed';
const VARIABLE_KINDS: VariableKind[] = ['parameter', 'answer', 'computed', 'fixed'];

const MAX_VARIABLES = 30;
const MIN_LENGTH = 3; // shorter values would be found everywhere
const MAX_LENGTH = 200; // longer ones are content, not a value to vary

// Where a value is: in a call's URL path, its query, what it sent or the answer it got (`path`: the
// JSON path, the query's name, or the path's place). `call` counts the calls ticked, from 1.
interface Place {
  call: number;
  where: 'url' | 'query' | 'sent' | 'answer';
  path: string;
}

export interface Variable {
  name: string;
  value: string;
  kind: VariableKind;
  detected: Exclude<VariableKind, 'fixed'>; // what it was found as: the kinds it may take
  from?: Place; // the answer it comes from (answer, computed)
  uses: Place[];
}

// What the user changed of a variable, by its value: its name, its kind. "removed" comes from older
// builds (their ×): it goes as recorded, as fixed does.
export type VariableEdit = { name?: string; kind?: VariableKind | 'removed' };

interface Leaf extends Place {
  value: string;
}

// A URL's query, as leaves (name, value).
export function queryLeaves(url: string): { path: string; value: string }[] {
  try {
    return [...new URL(url).searchParams].map(([path, value]) => ({ path, value }));
  } catch {
    return [];
  }
}

// The values of a JSON value or a form, each with its path ("version.number", "items[0].id"); of a
// multipart form, by its part names; of JSON line by line (NDJSON, SSE), as a list ("[0].id"). Any other
// text with named parts (name="…") is one value, "(body)": the review flags it as one it cannot read.
export function jsonLeaves(text: string | undefined): { path: string; value: string }[] {
  if (!text) return [];
  let data = parsedJson(text);
  if (data === undefined) {
    const trimmed = text.trim();
    if (FORM_BODY.test(trimmed)) return [...new URLSearchParams(trimmed)].map(([path, value]) => ({ path, value }));
    const parts = multipartPairs(text);
    if (parts) return parts.map(([path, value]) => ({ path, value }));
    data = parsedLines(text);
    if (data === undefined) return NAMED_PARTS.test(text) ? [{ path: '(body)', value: text }] : [];
  }
  const out: { path: string; value: string }[] = [];
  const walk = (v: unknown, path: string) => {
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
    else if (typeof v === 'string' || typeof v === 'number') out.push({ path, value: String(v) });
  };
  walk(data, '');
  return out;
}

const parsedJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
};
// NDJSON, or SSE's data: lines, as a list of the lines that are JSON; none when no line is.
function parsedLines(text: string): unknown[] | undefined {
  const lines = text.split('\n').map(jsonOfLine).filter((l): l is string => l !== undefined).map(parsedJson).filter((v) => v !== undefined);
  return lines.length ? lines : undefined;
}

// What a call sent: the parts of its URL's path that look like ids, its query, and its body.
function sentLeaves(c: RecordedCall, call: number): Leaf[] {
  let u: URL;
  try {
    u = new URL(c.url);
  } catch {
    return [];
  }
  const parts = u.pathname.split('/').filter(Boolean);
  return [
    ...parts.flatMap((p, i) => (isIdLike(p) ? [{ call, where: 'url' as const, path: parts[i - 1] ?? '/', value: decodeURIComponent(p) }] : [])),
    ...[...u.searchParams].map(([path, value]) => ({ call, where: 'query' as const, path, value })),
    ...jsonLeaves(c.requestBody).map((l) => ({ call, where: 'sent' as const, ...l })),
  ];
}
const isIdLike = (p: string) => /\d/.test(p) && p.length >= 2;

// A value to vary: not too short or long, not hidden, not true/false, not markup (content, not a value).
const usable = (v: string) => v.length >= MIN_LENGTH && v.length <= MAX_LENGTH && !v.includes(HIDDEN) && !/^(true|false|null)$/i.test(v) && !/[<{]/.test(v);
// Whether a value sent holds `value`: it is it, or has it as a word (not inside another: "revenue" is
// not in "ds-revenue-2026"). One test per value, for every value sent.
function holder(value: string): (sent: string) => boolean {
  const word = new RegExp(`(^|[^\\w-])${escapeRegExp(value)}($|[^\\w-])`);
  return (sent) => sent === value || (sent.length > value.length && word.test(sent));
}

// Keys whose values say what kind of thing, not which: constants of the API, not inputs.
const CONSTANT_KEY = /^(type|kind|representation|format|mode|status|op|operation|action|lang|locale|expand|fields|sort|order)$/i;
const constant = (path: string) => CONSTANT_KEY.test(path.split('.').at(-1)?.replace(/\[\d+\]$/, '') ?? '');
const GENERIC_KEY = /^(id|number|name|value|key|uuid|text|title)$/i;

// A name for a value from where it is: its key ("version.number" → versionNumber, a lone "id" → the
// URL's last word + Id), the query's name, or the URL's word before it ("content/12345" → contentId).
function nameOf(place: Place, calls: RecordedCall[]): string {
  const camel = (words: string[]) =>
    words.map((w) => w.replace(/[^a-z0-9]/gi, '')).filter(Boolean).map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w[0]!.toLowerCase() + w.slice(1))).join('') || 'value';
  if (place.where === 'url') return camel([singular(place.path), 'id']);
  if (place.where === 'query') return camel([place.path]);
  const keys = place.path.replace(/\[\d+\]/g, '').split('.').filter(Boolean);
  const last = keys.at(-1) ?? 'value';
  if (!GENERIC_KEY.test(last)) return camel([last]);
  if (keys.length > 1) return camel(keys.slice(-2));
  const url = calls[place.call - 1]?.url ?? '';
  const word = new URL(url, 'https://x').pathname.split('/').filter((p) => p && !isIdLike(p)).at(-1);
  return camel([word ? singular(word) : 'item', last]);
}
const singular = (w: string) => w.replace(/ies$/, 'y').replace(/s$/, '');

// The variables of the calls ticked, as found (before the user's changes).
export function detectVariables(r: Recording): Variable[] {
  const calls = recordedCalls(r);
  const sent = calls.flatMap((c, i) => sentLeaves(c, i + 1)).filter((l) => !r.hidden.includes(l.value));
  const answers = calls.flatMap((c, i) => jsonLeaves(c.responseBody).map((l) => ({ call: i + 1, where: 'answer' as const, ...l })));
  const found = new Map<string, Omit<Variable, 'name' | 'kind'>>();
  const usesOf = (value: string, after: number) => {
    const holds = holder(value);
    return sent.filter((l) => l.call > after && holds(l.value)).map(({ value: _v, ...place }) => place);
  };

  for (const a of answers) {
    if (found.has(a.value)) continue;
    const { value: _v, ...from } = a;
    if (usable(a.value) && !constant(a.path)) {
      const uses = usesOf(a.value, a.call);
      if (uses.length) found.set(a.value, { value: a.value, detected: 'answer', from, uses });
    }
    // A number sent as one more than an answer gave.
    if (/^\d+$/.test(a.value)) {
      const next = String(Number(a.value) + 1);
      const uses = sent.filter((l) => l.call > a.call && l.value === next).map(({ value: _v2, ...place }) => place);
      if (uses.length && !found.has(next)) found.set(next, { value: next, detected: 'computed', from, uses });
    }
  }
  for (const l of sent) {
    if (found.has(l.value) || !usable(l.value) || constant(l.path)) continue;
    if (answers.some((a) => a.call < l.call && a.value === l.value)) continue;
    found.set(l.value, { value: l.value, detected: 'parameter', uses: usesOf(l.value, 0) });
  }

  const order = { answer: 0, computed: 1, parameter: 2 };
  const names = new Set<string>();
  return [...found.values()]
    .sort((a, b) => order[a.detected] - order[b.detected])
    .slice(0, MAX_VARIABLES)
    .map((v) => {
      const base = nameOf(v.from ?? v.uses[0]!, calls);
      let name = base;
      for (let n = 2; names.has(name); n++) name = `${base}${n}`;
      names.add(name);
      return { ...v, name, kind: v.detected };
    });
}

// The variables with the user's changes: renamed, or of another kind (`found`: as found).
export function variablesOf(r: Recording, found = detectVariables(r)): Variable[] {
  return found.map((v) => {
    const edit = r.vars?.[v.value];
    const kind = edit?.kind === 'removed' ? 'fixed' : edit?.kind;
    return { ...v, ...(edit?.name?.trim() && { name: edit.name.trim() }), ...(kind && { kind }) };
  });
}

// A kind as what happens when the tool runs.
const kindLabel = (kind: VariableKind, from?: Place) =>
  kind === 'parameter' ? 'You give it each time'
  : kind === 'answer' ? (from ? `From #${from.call}'s answer` : 'From an answer')
  : kind === 'computed' ? 'Worked out (+1)'
  : 'Always as recorded';

// The kinds a variable may take: given each time, what it was found as, or as recorded.
export const kindsFor = (v: Pick<Variable, 'detected' | 'from'>) =>
  VARIABLE_KINDS.filter((k) => k === v.detected || k === 'parameter' || k === 'fixed').map((value) => ({ value, label: kindLabel(value, v.from) }));

// "#1 (version.number)": the call and the path in it, for an answer a value comes from.
export const answerText = (p: Place) => `#${p.call}${p.path ? ` (${p.path})` : ''}`;

// "#2 query (q)", "#4 sent (version.number)", "#1 URL (after content)"
export const placeText = (p: Place) =>
  `#${p.call} ${p.where === 'url' ? 'URL' : p.where}${p.path ? ` (${p.where === 'url' ? `after ${p.path}` : p.path})` : ''}`;

// For the review: "from #1 items[0].id · used in #2, #3 URL", "#2 version.number (7) + 1 · used in #3
// sent version.number". The calls that use it in the same place go together; a URL's place is not said.
export function routeText(v: Pick<Variable, 'value' | 'kind' | 'from' | 'uses'>): string {
  const at = (call: number, path: string) => `#${call}${path ? ` ${path}` : ''}`;
  const from = v.from && at(v.from.call, v.from.path);
  const source = v.kind === 'answer' && from ? `from ${from}` : v.kind === 'computed' && from ? `${from} (${Number(v.value) - 1}) + 1` : '';
  const places = new Map<string, number[]>();
  for (const u of v.uses) {
    const where = u.where === 'url' ? 'URL' : `${u.where}${u.path ? ` ${u.path}` : ''}`;
    places.set(where, [...(places.get(where) ?? []), u.call]);
  }
  const used = [...places].map(([where, calls]) => `${[...new Set(calls)].map((n) => `#${n}`).join(', ')} ${where}`).join('; ');
  return [source, `used in ${used}`].filter(Boolean).join(' · ');
}
