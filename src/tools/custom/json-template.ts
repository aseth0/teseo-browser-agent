// A request's JSON body as a template ({name} for an input, unquoted; {{secret:name}} for a saved
// value, quoted in a text or alone for a number), read for where each value is, so that one can be
// replaced in place: nothing else of the text changes (its spacing, its big numbers, a key given
// twice), as it would through JSON.parse and JSON.stringify.

export type JsonPath = (string | number)[];

export interface JsonSpot {
  path: JsonPath;
  start: number;
  end: number;
  raw: string; // as written: "\"a\\\"b\"", 12, true, {query}, {{secret:key}}
  kind: 'string' | 'number' | 'boolean' | 'null' | 'input' | 'secret';
}

const INPUT = /\{[a-z][a-z0-9_]*\}/y;
const SECRET = /\{\{\s*secret:[^}]+?\s*\}\}/y;
const LITERAL = /-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/y;

class NotJson extends Error {}

// The values of the body (none of its objects and lists, only what they hold), or undefined when it
// is not JSON with templates.
export function scanJsonTemplate(text: string): JsonSpot[] | undefined {
  const spots: JsonSpot[] = [];
  let i = 0;
  const space = () => {
    while (i < text.length && /\s/.test(text[i]!)) i++;
  };
  const expect = (c: string) => {
    space();
    if (text[i] !== c) throw new NotJson();
    i++;
  };
  const sticky = (re: RegExp) => {
    re.lastIndex = i;
    return re.exec(text)?.[0];
  };
  const string = (): string => {
    const start = i++;
    while (i < text.length && text[i] !== '"') i += text[i] === '\\' ? 2 : 1;
    if (i >= text.length) throw new NotJson();
    i++;
    return JSON.parse(text.slice(start, i)) as string;
  };
  const value = (path: JsonPath) => {
    space();
    const start = i;
    const spot = (kind: JsonSpot['kind']) => spots.push({ path, start, end: i, raw: text.slice(start, i), kind });
    const c = text[i];
    const template = sticky(INPUT) ?? sticky(SECRET);
    if (template) {
      i += template.length;
      return spot(template.startsWith('{{') ? 'secret' : 'input');
    }
    if (c === '{') return members(path);
    if (c === '[') return elements(path);
    if (c === '"') {
      string();
      return spot('string');
    }
    const literal = sticky(LITERAL);
    if (!literal) throw new NotJson();
    i += literal.length;
    spot(literal === 'null' ? 'null' : literal === 'true' || literal === 'false' ? 'boolean' : 'number');
  };
  const members = (path: JsonPath) => {
    i++;
    space();
    if (text[i] === '}') return void i++;
    for (;;) {
      space();
      if (text[i] !== '"') throw new NotJson();
      const key = string();
      expect(':');
      value([...path, key]);
      space();
      if (text[i] === ',') i++;
      else return expect('}');
    }
  };
  const elements = (path: JsonPath) => {
    i++;
    space();
    if (text[i] === ']') return void i++;
    for (let n = 0; ; n++) {
      value([...path, n]);
      space();
      if (text[i] === ',') i++;
      else return expect(']');
    }
  };
  try {
    value([]);
    space();
    return i === text.length ? spots : undefined;
  } catch {
    return undefined;
  }
}

// The text with that spot written otherwise.
export const replaceSpot = (text: string, spot: Pick<JsonSpot, 'start' | 'end'>, raw: string) => text.slice(0, spot.start) + raw + text.slice(spot.end);

export const samePath = (a: JsonPath, b: JsonPath) => a.length === b.length && a.every((k, i) => k === b[i]);

// A text spot's value as the user reads it, and its JSON content as written between the quotes.
export const spotText = (spot: JsonSpot) => (spot.kind === 'string' ? (JSON.parse(spot.raw) as string) : spot.raw);
export const spotInner = (spot: JsonSpot) => (spot.kind === 'string' ? spot.raw.slice(1, -1) : spot.raw);
