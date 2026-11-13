// A tool call's arguments as its schema declares them, then checked against it, so that a call the
// tool cannot take is answered with what to fix before anything runs.
// coerceArgs reads what a model often sends in another form, where only one reading fits: an object
// or a list as its JSON text ("[\"a\", \"b\"]"), a number or a yes/no as text ("5", "true"), a number
// or a yes/no where text is asked for, one value where a list of them is, an option in other case
// ("Down" for "down"), a name in another case or style (tab_id for tabId), and null for a value that
// may not be null (left out, as if not given). checkArgs then finds what still does not fit: a
// required value left out, a value of another type, one not among the options, a name close to one
// the tool takes. Both go into objects and lists; a property under anyOf, oneOf or allOf is taken as
// it comes.
import type { JSONSchema } from './types';
import { near } from './similar';
import { isObject } from './util';

interface Schema {
  type?: string | string[];
  anyOf?: unknown;
  oneOf?: unknown;
  allOf?: unknown;
  enum?: unknown[];
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  additionalProperties?: unknown;
}

const MAX_DEPTH = 8; // nested deeper than this, a value is taken as it comes

const schemaOf = (s: unknown): Schema | undefined => (isObject(s) ? s : undefined);
// None: anything goes (no type, or a choice of schemas).
const typesOf = (s: Schema): string[] | undefined => (s.anyOf || s.oneOf || s.allOf || s.type === undefined ? undefined : Array.isArray(s.type) ? s.type : [s.type]);

// Whether the value is of one of the types (an integer as any number: the tools round it).
function isOfType(value: unknown, types: string[]): boolean {
  return types.some((t) => {
    switch (t) {
      case 'string':
        return typeof value === 'string';
      case 'number':
      case 'integer':
        return typeof value === 'number' && Number.isFinite(value);
      case 'boolean':
        return typeof value === 'boolean';
      case 'null':
        return value === null;
      case 'array':
        return Array.isArray(value);
      case 'object':
        return isObject(value);
      default:
        return true; // a type this check does not know
    }
  });
}

const NUMBER = /^\s*-?\d+(\.\d+)?\s*$/;
// A name as compared across styles: tab_id, tabId, TabID and tab-id are the same.
const plain = (name: string) => name.toLowerCase().replace(/[_-]/g, '');

// The value read as one of the types, when it is in a form that can only mean that; else as it came.
function read(value: unknown, types: string[]): unknown {
  if (typeof value === 'string' && !types.includes('string')) {
    if (types.includes('object') || types.includes('array')) {
      try {
        const parsed: unknown = JSON.parse(value);
        if (isOfType(parsed, types)) return parsed;
      } catch {
        // not JSON
      }
    }
    if ((types.includes('number') || types.includes('integer')) && NUMBER.test(value)) return Number(value);
    if (types.includes('boolean') && /^\s*(true|false)\s*$/i.test(value)) return value.trim().toLowerCase() === 'true';
    return value;
  }
  if ((typeof value === 'number' || typeof value === 'boolean') && types.includes('string') && !isOfType(value, types)) return String(value);
  return value;
}

// The value as the schema declares it (the same value when nothing changes).
function coerceValue(schema: Schema, value: unknown, depth: number): unknown {
  const types = typesOf(schema);
  if (!types || depth > MAX_DEPTH) return value;
  let v = read(value, types);
  const items = schemaOf(schema.items);
  // One value where a list of them is asked for: a list of it, when it is what the list holds.
  const itemTypes = items && typesOf(items);
  if (itemTypes && !isOfType(v, types) && types.includes('array') && v !== null) {
    const one = read(v, itemTypes);
    if (isOfType(one, itemTypes)) v = [one];
  }
  if (typeof v === 'string' && schema.enum && !schema.enum.includes(v)) {
    const wanted = v.trim().toLowerCase();
    const same = schema.enum.filter((o): o is string => typeof o === 'string' && o.toLowerCase() === wanted);
    if (same.length === 1) v = same[0];
  }
  if (Array.isArray(v) && items) {
    const given: unknown[] = v;
    const list = given.map((item) => coerceValue(items, item, depth + 1));
    return list.every((item, i) => item === given[i]) ? given : list;
  }
  if (isObject(v) && schema.properties) return coerceObject(schema, v, depth);
  return v;
}

function coerceObject(schema: Schema, given: Record<string, unknown>, depth: number): Record<string, unknown> {
  const properties = schema.properties ?? {};
  let out: Record<string, unknown> | undefined;
  for (const [key, value] of Object.entries(given)) {
    let name = key;
    if (!(key in properties)) {
      // A name the tool takes, written in another case or style, that the call does not give as well.
      const same = Object.keys(properties).filter((p) => plain(p) === plain(key) && !(p in given));
      if (same.length !== 1) continue;
      name = same[0]!;
    }
    const prop = schemaOf(properties[name]);
    const types = prop && typesOf(prop);
    // Null for a value that may not be null: as if it were not given.
    const dropped = value === null && !!types && !types.includes('null');
    const v = dropped || !prop ? value : coerceValue(prop, value, depth + 1);
    if (name === key && v === value && !dropped) continue;
    out ??= { ...given };
    if (name !== key) delete out[key];
    if (dropped) delete out[name];
    else out[name] = v;
  }
  return out ?? given;
}

// The arguments as the tool's schema declares them; the same object when nothing changes.
export function coerceArgs(inputSchema: JSONSchema, args: unknown): unknown {
  const schema = schemaOf(inputSchema);
  if (!isObject(args) || !schema?.properties) return args;
  return coerceObject(schema, args, 0);
}

// What still does not fit the schema: `missing`, the required top-level arguments left out (null
// counts as left out); `invalid`, every other problem, with where it is ("options.items[2]").
export interface ArgProblem {
  at: string;
  problem: string;
}
export interface ArgCheck {
  missing: string[];
  invalid: ArgProblem[];
}

// A problem as the model reads it.
export const problemLine = ({ at, problem }: ArgProblem) => `${at}: ${problem}`;

const SHOWN = 60; // of a value quoted in a problem, what is shown
const shown = (value: unknown) => {
  const s = JSON.stringify(value) ?? String(value);
  return s.length > SHOWN ? `${s.slice(0, SHOWN)}…` : s;
};
const kindOf = (value: unknown) => (value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value);

export function checkArgs(inputSchema: JSONSchema, args: unknown): ArgCheck {
  const schema = schemaOf(inputSchema) ?? {};
  const out: ArgCheck = { missing: [], invalid: [] };
  const given = isObject(args) ? args : {};
  out.missing = (schema.required ?? []).filter((k) => given[k] === undefined || given[k] === null);
  checkObject(schema, given, '', 0, out.invalid);
  return out;
}

function checkValue(schema: Schema, value: unknown, at: string, depth: number, problems: ArgProblem[]): void {
  if (depth > MAX_DEPTH) return;
  const types = typesOf(schema);
  if (types && !isOfType(value, types)) {
    problems.push({ at, problem: `expected ${types.join(' or ')}, got ${kindOf(value)} ${shown(value)}` });
    return;
  }
  if (schema.enum && !schema.enum.some((o) => o === value || JSON.stringify(o) === JSON.stringify(value))) {
    problems.push({ at, problem: `${shown(value)} is not one of ${schema.enum.map((o) => (typeof o === 'string' ? o : shown(o))).join(', ')}` });
    return;
  }
  if (!types) return;
  const items = schemaOf(schema.items);
  if (Array.isArray(value) && items) value.forEach((item, i) => checkValue(items, item, `${at}[${i}]`, depth + 1, problems));
  if (isObject(value) && schema.properties) {
    for (const k of schema.required ?? []) if (value[k] === undefined || value[k] === null) problems.push({ at: `${at}.${k}`, problem: 'required, left out' });
    checkObject(schema, value, `${at}.`, depth, problems);
  }
}

function checkObject(schema: Schema, value: Record<string, unknown>, prefix: string, depth: number, problems: ArgProblem[]): void {
  const properties = schema.properties;
  if (!properties) return;
  for (const [key, v] of Object.entries(value)) {
    const prop = schemaOf(properties[key]);
    if (prop) {
      if (v !== undefined && !(v === null && schema.required?.includes(key))) checkValue(prop, v, `${prefix}${key}`, depth + 1, problems);
      continue;
    }
    // A name the tool does not take: said when it is close to one the call leaves out (a typo, the
    // tool would not see it), or when the schema takes no other.
    const close = Object.keys(properties).filter((p) => !(p in value) && near(plain(p), plain(key)));
    if (close.length) problems.push({ at: `${prefix}${key}`, problem: `unknown argument; did you mean ${close.join(' or ')}?` });
    else if (schema.additionalProperties === false) problems.push({ at: `${prefix}${key}`, problem: `unknown argument; it takes ${Object.keys(properties).join(', ') || 'none'}` });
  }
}

// Arguments a server sent that are not JSON: kept as they came (as an object, so that they go back
// to the server as valid JSON), never run.
const UNPARSED = '__unparsedArguments';
interface Unparsed {
  text: string;
  error: string;
}
export const unparsedArgs = (text: string, error: string): Record<string, Unparsed> => ({ [UNPARSED]: { text, error } });

const BEGINNING = 200; // of unparsed arguments, what the model is shown
const AROUND = 40; // of them, what is shown each side of where parsing failed

// Why a call is not run, said before its schema is checked: arguments that are not JSON, or none at
// all for a tool that requires some (often a server cutting them off), with a short reason for the
// log and the required arguments left out; undefined for any other.
export function wireArgsError(inputSchema: JSONSchema, args: unknown): { content: string; reason: string; missing: string[] } | undefined {
  const unparsed = isObject(args) && Object.keys(args).length === 1 && isObject(args[UNPARSED]) ? (args[UNPARSED] as Partial<Unparsed>) : undefined;
  if (typeof unparsed?.text === 'string') {
    const { text: s, error = '' } = unparsed;
    const start = s.length > BEGINNING ? `${s.slice(0, BEGINNING)}…` : s;
    // Where it fails, as V8's JSON.parse says it ("… at position 12"); none in another wording.
    const at = Number(/position (\d+)/.exec(error)?.[1]);
    const around = Number.isFinite(at) && at > BEGINNING - AROUND ? `\nAround where parsing failed: «…${s.slice(at - AROUND, at + AROUND)}…»` : '';
    const content = `The arguments of this call are not valid JSON (${error}), so nothing was run. They began with:\n«${start}»${around}\nSend the call again with its arguments as one valid JSON object (quotes and newlines inside strings escaped).`;
    return { content, reason: 'arguments not JSON', missing: [] };
  }
  const required = schemaOf(inputSchema)?.required ?? [];
  if (isObject(args) && !Object.keys(args).length && required.length) {
    const content = `This call arrived with no arguments at all, so nothing was run; it requires ${required.join(', ')}. The server may have cut them off. Send the call again complete. If its arguments are long (code, a long text), split the work into smaller calls.`;
    return { content, reason: 'no arguments', missing: required };
  }
  return undefined;
}
