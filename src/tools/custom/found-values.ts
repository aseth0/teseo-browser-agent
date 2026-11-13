// The values written in a request (ids in its path, its query's, its JSON body's) and who sets each:
// fixed, filled by the model (an input, {name} where the value was), or a saved value
// ({{secret:name}}, never seen by the model). Each change writes only that value's place.
import type { HttpRequest } from '../http';
import { isCredential, isCredentialSegment } from './credentials';
import { replaceSpot, samePath, scanJsonTemplate, spotText, type JsonPath, type JsonSpot } from './json-template';
import { singular, snake, uniqueName } from './names';
import { decode, joinQuery, joinUrl, queryPairs, splitUrl } from './request-url';
import type { InputType } from './types';

export type Who = 'fixed' | 'model' | 'secret';

export interface FoundValue {
  where: 'path' | 'query' | 'body';
  id: string; // unique in the request: "query:2", "path:3", "body:[\"text\"]"
  label: string; // the query or body key; the path's segment before it
  at: number; // the query pair's or path segment's position
  path?: JsonPath; // in the body
  value: string; // as the user reads it ("" for a saved value: not shown)
  name: string; // the input or saved value it would become
  type: InputType;
  secret?: string; // the saved value's name, when it is one
  suspect: boolean; // fixed, but looks like a key
  minor?: boolean; // a part of the path that is neither an id nor a key: listed apart, to make one a saved value by hand
}

// How a value goes back once the model no longer fills it: as written in a URL, and in JSON.
export interface FixedValue {
  inUrl: string;
  inJson: string;
}

const SECRET_WHOLE = /^\{\{\s*secret:([^}]+?)\s*\}\}$/;
const isTemplate = (s: string) => /[{}]/.test(decode(s));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// A path segment that is an id: a number, a UUID, or a long run of letters and digits with a digit.
const looksLikeId = (s: string) => !!s && !isTemplate(s) && (/^\d+$/.test(s) || UUID.test(s) || (/^[A-Za-z0-9_-]{12,}$/.test(s) && /\d/.test(s)));
const typeOf = (v: string): InputType => (/^-?\d+(\.\d+)?$/.test(v) ? 'number' : v === 'true' || v === 'false' ? 'boolean' : 'string');
const MAX_BODY_VALUES = 40;

export function foundValues(http: Pick<HttpRequest, 'method' | 'url' | 'body'>): FoundValue[] {
  const found: FoundValue[] = [];
  const url = splitUrl(http.url);
  const segments = url.path.split('/');
  const plain = (s: string) => !!s && !looksLikeId(s) && !isTemplate(s) && !isCredentialSegment(s);
  segments.forEach((segment, at) => {
    const secret = SECRET_WHOLE.exec(segment)?.[1];
    if (!secret && (!segment || isTemplate(segment))) return;
    const key = !secret && isCredentialSegment(segment);
    const id = !secret && !key && looksLikeId(segment);
    const before = segments.slice(0, at).reverse().find(plain);
    const word = singular(snake(before ?? ''));
    found.push({
      where: 'path', id: `path:${at}`, label: before ?? '', at,
      value: secret ? '' : decode(segment),
      name: secret ?? (key ? 'token' : id ? (word ? `${word}_id` : 'id') : snake(decode(segment)) || 'part'),
      type: 'string',
      ...(secret && { secret }),
      suspect: key,
      ...(!secret && !key && !id && { minor: true }),
    });
  });
  queryPairs(url.query).forEach((p, at) => {
    if (!p.hasValue || !p.raw) return;
    const secret = SECRET_WHOLE.exec(p.raw)?.[1];
    if (!secret && isTemplate(p.raw)) return;
    const value = secret ? '' : decode(p.raw);
    found.push({
      where: 'query', id: `query:${at}`, label: p.name, at, value,
      name: secret ?? (snake(p.name) || 'value'),
      type: secret ? 'string' : typeOf(value),
      ...(secret && { secret }),
      suspect: !secret && isCredential(p.name, value),
    });
  });
  if (http.method !== 'GET' && http.body?.trim()) {
    for (const spot of (scanJsonTemplate(http.body) ?? []).slice(0, MAX_BODY_VALUES)) {
      const f = bodyValue(spot);
      if (f) found.push(f);
    }
  }
  // Each its own name.
  const names = new Set<string>();
  return found.map((f) => {
    const name = f.secret ?? uniqueName(f.name, names);
    names.add(name);
    return { ...f, name };
  });
}

function bodyValue(spot: JsonSpot): FoundValue | undefined {
  const key = spot.path.findLast((k): k is string => typeof k === 'string') ?? '';
  const label = spot.path.map((k) => (typeof k === 'number' ? `[${k}]` : k)).join('.').replace(/\.\[/g, '[');
  const base = { where: 'body' as const, id: `body:${JSON.stringify(spot.path)}`, label: label || '(the body)', at: 0, path: spot.path };
  const text = spot.kind === 'string' ? spotText(spot) : spot.raw;
  const secret = spot.kind === 'secret' ? SECRET_WHOLE.exec(spot.raw)?.[1] : spot.kind === 'string' ? SECRET_WHOLE.exec(text)?.[1] : undefined;
  if (secret) return { ...base, value: '', name: secret, type: 'string', secret, suspect: false };
  if (spot.kind !== 'string' && spot.kind !== 'number' && spot.kind !== 'boolean') return undefined;
  if (spot.kind === 'string' && isTemplate(text)) return undefined;
  const type: InputType = spot.kind === 'number' ? 'number' : spot.kind === 'boolean' ? 'boolean' : 'string';
  return { ...base, value: text, name: snake(key) || 'value', type, suspect: isCredential(key, text) };
}

// The request with what is at that value's place written otherwise: in the URL as `inUrl`, in the
// body as `inJson` (the whole JSON value, with its quotes for a text).
function writeAt(http: HttpRequest, f: FoundValue, write: { inUrl: string; inJson: string }): HttpRequest {
  if (f.where === 'body') {
    const spot = scanJsonTemplate(http.body ?? '')?.find((s) => samePath(s.path, f.path!));
    return spot ? { ...http, body: replaceSpot(http.body!, spot, write.inJson) } : http;
  }
  const url = splitUrl(http.url);
  if (f.where === 'query') {
    const pairs = queryPairs(url.query);
    if (!pairs[f.at]) return http;
    pairs[f.at] = { ...pairs[f.at]!, raw: write.inUrl };
    return { ...http, url: joinUrl({ ...url, query: joinQuery(pairs) }) };
  }
  const segments = url.path.split('/');
  if (segments[f.at] === undefined) return http;
  segments[f.at] = write.inUrl;
  return { ...http, url: joinUrl({ ...url, path: segments.join('/') }) };
}

// What is written at its place now: encoded in a URL, its JSON in the body (a saved value's own).
function writtenNow(http: HttpRequest, f: FoundValue): FixedValue | undefined {
  const saved = f.secret === undefined ? undefined : http.secrets?.[f.secret];
  if (f.where === 'body') {
    const spot = scanJsonTemplate(http.body ?? '')?.find((s) => samePath(s.path, f.path!));
    if (!spot) return undefined;
    // A saved text keeps its quotes; a number saved alone, without.
    const inJson = f.secret === undefined ? spot.raw : spot.kind === 'string' ? `"${saved ?? ''}"` : (saved ?? 'null');
    const value = f.secret === undefined ? f.value : inJson.startsWith('"') ? (JSON.parse(inJson) as string) : inJson;
    return { inJson, inUrl: encodeURIComponent(value) };
  }
  const url = splitUrl(http.url);
  const raw = f.where === 'query' ? queryPairs(url.query)[f.at]?.raw : url.path.split('/')[f.at];
  if (raw === undefined) return undefined;
  const inUrl = f.secret === undefined ? raw : (saved ?? '');
  const value = decode(inUrl);
  return { inUrl, inJson: f.type === 'string' ? JSON.stringify(value) : value };
}

const withoutSecret = (http: HttpRequest, name: string | undefined): HttpRequest => {
  if (name === undefined || !http.secrets) return http;
  const { [name]: _, ...rest } = http.secrets;
  return { ...http, secrets: Object.keys(rest).length ? rest : undefined };
};

// The model fills it: {name} at its place (alone, without quotes, in the body). The value it had, to
// fix it again.
export function letModelFill(http: HttpRequest, f: FoundValue, name: string): { http: HttpRequest; was?: FixedValue } {
  const was = writtenNow(http, f);
  const hole = `{${name}}`;
  return { http: withoutSecret(writeAt(http, f, { inUrl: hole, inJson: hole }), f.secret), was };
}

// A saved value: {{secret:name}} at its place, the value as it was written there (so that it goes
// back as it came: encoded in a URL, escaped in a JSON text).
export function keepAsSecret(http: HttpRequest, f: FoundValue, name: string): HttpRequest {
  const was = writtenNow(http, f);
  if (!was) return http;
  const ref = `{{secret:${name}}}`;
  const text = f.where === 'body' && was.inJson.startsWith('"');
  const saved = f.where === 'body' ? (text ? was.inJson.slice(1, -1) : was.inJson) : was.inUrl;
  const next = writeAt(http, f, { inUrl: ref, inJson: text ? `"${ref}"` : ref });
  return { ...next, secrets: { ...next.secrets, [name]: saved } };
}

// Fixed: a saved value written back at its place.
export function fixSecret(http: HttpRequest, f: FoundValue): HttpRequest {
  const was = writtenNow(http, f);
  return was ? withoutSecret(writeAt(http, f, was), f.secret) : http;
}

// Fixed again: every {name} of the request back to the value it replaced, in the URL and the body.
export function fixAgain(http: HttpRequest, name: string, was: FixedValue): HttpRequest {
  const hole = `{${name}}`;
  return { ...http, url: http.url.split(hole).join(was.inUrl), ...(http.body !== undefined && { body: http.body.split(hole).join(was.inJson) }) };
}

// Who sets a found value now.
export const whoSets = (f: FoundValue): Who => (f.secret ? 'secret' : 'fixed');

