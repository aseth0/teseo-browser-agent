// Find/replace edits of a long saved text (a skill's or an agent's instructions, a template view, a
// script's code), so that the model sends only what changes: each `old` must appear once in the text
// as the edits before it left it.
import { similarity } from '../core/similar';
import { fields } from './define';

export interface TextEdit {
  old: string;
  new: string;
}

// `what`: the text they change, as the model is told ("the saved instructions").
export const editsSchema = (what: string) => ({
  type: 'array',
  description:
    `Changes to ${what}, in order, each on the result of the one before: "old" is text copied exactly from it, spaces and line ` +
    'breaks included, that appears in it once; "new" replaces it ("" deletes it).',
  items: { type: 'object', properties: { old: { type: 'string' }, new: { type: 'string' } }, required: ['old', 'new'] },
});

const SNIPPET = 80;
const snippet = (s: string) => (s.length > SNIPPET ? `${s.slice(0, SNIPPET)}…` : s);

// Where a text is, for the errors: `field` as a sentence names it ("the instructions"), `read` the tool
// it is read with.
export interface EditedField {
  field: string;
  read: string;
}

// The edits a call gives: a list of { old, new } (a single one is a list of one); undefined, none given.
function editList(raw: unknown): TextEdit[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  const list = Array.isArray(raw) ? raw : [raw];
  return list.map((e) => {
    const f = fields(e);
    return { old: typeof f.old === 'string' ? f.old : '', new: typeof f.new === 'string' ? f.new : String(f.new ?? '') };
  });
}

const CLOSEST_SHOWN = 400; // at most, of the closest text
const CLOSEST_MAX = 200_000; // a longer text is not searched
const LIKE_ENOUGH = 0.6; // of the pairs of characters the closest lines share with an "old"

// What in `text` an "old" that is not in it was meant to be: the same but for spaces and line breaks,
// or for escaping (\n, \" sent as such); else the lines most like it, if alike enough. Undefined: none.
function closestText(text: string, old: string): string | undefined {
  if (text.length > CLOSEST_MAX || !old.trim()) return undefined;
  const unescaped = old.replace(/\\(["\\nt])/g, (_, c: string) => (c === 'n' ? '\n' : c === 't' ? '\t' : c));
  for (const tried of unescaped === old ? [old] : [unescaped, old]) {
    if (text.includes(tried)) return cut(tried);
    const loose = looseMatch(text, tried);
    if (loose) return cut(loose);
  }
  return cut(likestLines(text, unescaped));
}
const cut = (s: string | undefined) => (s && s.length > CLOSEST_SHOWN ? `${s.slice(0, CLOSEST_SHOWN)}…` : s);

// The part of `text` that is `old` but for its spaces and line breaks (as many, of any kind, or none
// between words and signs).
function looseMatch(text: string, old: string): string | undefined {
  const parts = old.trim().split(/\s+/).map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const found = new RegExp(parts.join('\\s*')).exec(text);
  return found?.[0];
}

// The lines of `text`, as many as `old` has, most like it.
function likestLines(text: string, old: string): string | undefined {
  const lines = text.split('\n');
  const span = Math.max(1, old.trim().split('\n').length);
  let best: { score: number; text: string } | undefined;
  for (let i = 0; i + span <= lines.length; i++) {
    const candidate = lines.slice(i, i + span).join('\n');
    const score = similarity(candidate, old);
    if (!best || score > best.score) best = { score, text: candidate };
  }
  return best && best.score >= LIKE_ENOUGH ? best.text : undefined;
}

// The text with the edits applied, in order; and, for each that cannot be, why. One that fails leaves
// the text as it was, and the next ones apply to that.
// `param`: the parameter that gives the whole text instead.
export function applyEdits(text: string, edits: TextEdit[], where: EditedField, param?: string): { text: string; problems: string[] } {
  const problems: string[] = [];
  let now = text;
  edits.forEach((e, i) => {
    const n = i + 1;
    if (!e.old) {
      return problems.push(
        `Edit ${n}: "old" is empty; give the text to replace. To add text, put in "old" the text it goes after and in "new" that text followed by the new one` +
          `${param ? `; to replace all of it, give the whole "${param}" instead of edits` : ''}.`,
      );
    }
    const count = now.split(e.old).length - 1;
    if (count === 0) {
      const near = closestText(now, e.old);
      return problems.push(
        `Edit ${n}: this "old" is not in ${where.field}: "${snippet(e.old)}". Copy it exactly from ${where.read}, spaces and line breaks included (edits apply in order, each after the ones before it).` +
          (near ? ` The closest text in it, as a JSON string to copy into "old": ${JSON.stringify(near)}` : ''),
      );
    }
    if (count > 1) return problems.push(`Edit ${n}: this "old" appears ${count} times in ${where.field}: "${snippet(e.old)}". Quote more of the text around it, so that it appears once.`);
    now = now.replace(e.old, () => e.new);
  });
  return { text: now, problems };
}

// A long text as a call sets it: whole (`whole`, the parameter `param`), by edits of the saved one,
// or not at all (undefined: it stays). `missing`: what the model is told when there is nothing saved to edit.
export function editedText(
  args: Record<string, unknown>,
  param: string,
  saved: string | undefined,
  where: EditedField & { missing: string },
): { text?: string; problems: string[] } {
  const whole = args[param];
  // A list sent as valid JSON text was read as a list before this (core/tool-args coerceArgs).
  if (typeof args.edits === 'string') return { problems: ['"edits" is a list of objects, [{"old": "…", "new": "…"}], not a text: it was not JSON.'] };
  const edits = editList(args.edits);
  if (!edits) return { text: whole === undefined ? undefined : String(whole), problems: [] };
  if (whole !== undefined) return { problems: [`Give either "${param}" or "edits", not both.`] };
  if (saved === undefined) return { problems: [where.missing] };
  return applyEdits(saved, edits, where, param);
}
