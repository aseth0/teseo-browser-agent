// A request pasted in a custom tool's editor (a URL or a curl command) read as an HTTP request. What
// looks like a credential (tools/custom/credentials) never stays where the model reads it, its URL and
// body (custom_tools shows them to it): a header stays a header (the user's only), a key in the query
// or the body becomes a saved value ({{secret:name}}, tools/secrets), user:password@ in the URL a
// Basic header, and cookies are left out (the browser's session can be ticked instead).
import { errorText } from '../../core/errors';
import { HTTP_METHODS, headerNameProblem, type HttpRequest } from '../http';
import { isCredential, isCredentialSegment, isCredentialValue } from './credentials';
import { curlWords, readCurl, type CurlParts } from './curl';
import { replaceSpot, scanJsonTemplate, spotInner } from './json-template';
import { snake, uniqueName } from './names';
import { decode, joinQuery, joinUrl, queryPairs, splitUrl } from './request-url';

export interface PastedRequest {
  http: HttpRequest;
  notes: string[]; // what was done with its keys and what was left out, said to the user
}

// The pasted text as a request, or why not.
export function parsePastedRequest(text: string): PastedRequest | { problem: string } {
  try {
    const pasted = text.trim();
    if (!pasted) return { problem: 'Paste a URL or a curl command.' };
    if (/^https?:\/\/\S+$/i.test(pasted)) return fromParts({ url: pasted, headers: [] });
    const words = curlWords(pasted);
    if ('problem' in words) return words;
    const parts = readCurl(words);
    return 'problem' in parts ? parts : fromParts(parts);
  } catch (e) {
    return { problem: `It could not be read: ${errorText(e)}` };
  }
}

// Headers the browser sets itself, or that only describe the pasted call.
const BROWSER_HEADERS = /^(host|content-length|connection|accept-encoding|user-agent|origin|referer|priority|te|upgrade-insecure-requests|sec-.*|:.*)$/i;

// user:password@ as written in a URL: %-decoded only (a + is a +, not a space).
function decodeUserinfo(userinfo: string): string {
  try {
    return decodeURIComponent(userinfo);
  } catch {
    return userinfo;
  }
}

// Basic credentials, the text as UTF-8 (btoa takes Latin-1 only).
const basic = (userPassword: string) => `Basic ${btoa(String.fromCharCode(...new TextEncoder().encode(userPassword)))}`;

function fromParts(parts: CurlParts): PastedRequest | { problem: string } {
  const notes: string[] = [];
  const method = (parts.get ? 'GET' : (parts.method ?? (parts.body !== undefined ? 'POST' : 'GET'))) as HttpRequest['method'];
  if (!HTTP_METHODS.includes(method)) return { problem: `The method is one of ${HTTP_METHODS.join(', ')}, not ${method}.` };
  const secrets: Record<string, string> = {};
  // A saved value for a credential: its name from the key, as it is written there (encoded in a URL,
  // escaped in JSON), so that it goes back exactly as it came.
  const keep = (name: string, written: string) => {
    const key = uniqueName(snake(name) || 'key', new Set(Object.keys(secrets)));
    secrets[key] = written;
    return key;
  };
  const cookieHeader = parts.headers.some((h) => /^cookie$/i.test(h.name));
  const headers = parts.headers.filter((h) => !/^cookie$/i.test(h.name) && !BROWSER_HEADERS.test(h.name) && !headerNameProblem(h.name));
  const url = splitUrl(parts.url.trim());
  const user = parts.user ?? (url.userinfo !== undefined ? decodeUserinfo(url.userinfo) : undefined);
  if (user !== undefined && !headers.some((h) => /^authorization$/i.test(h.name))) headers.push({ name: 'Authorization', value: basic(user) });
  // -G: the data goes in the query.
  const query = parts.get && parts.body ? [url.query, parts.body].filter(Boolean).join('&') : url.query;
  let body = parts.get || method === 'GET' ? undefined : parts.body;
  if (body !== undefined) body = parts.form ? secretPairs(body, keep) : secretJson(body, keep);
  if (parts.form && body !== undefined && !headers.some((h) => /^content-type$/i.test(h.name))) {
    headers.push({ name: 'Content-Type', value: 'application/x-www-form-urlencoded' });
    notes.push('Its body is a form (name=value&…), not JSON: an HTTP request tool sends JSON bodies, so write it as JSON.');
  }
  // A key in the path ("/bot123456:ABC…/sendMessage") is a saved value too.
  const path = url.path
    .split('/')
    .map((segment) => (segment && !/[{}]/.test(segment) && isCredentialSegment(segment) ? `{{secret:${keep('token', segment)}}}` : segment))
    .join('/');
  // The fragment never reaches the server, and may hold a token (#access_token=…): left out.
  if (url.hash) notes.push('The part after # was left out: it is never sent to the site.');
  const http: HttpRequest = {
    method,
    url: joinUrl({ ...url, path, userinfo: undefined, hash: '', query: query === undefined ? undefined : secretPairs(query, keep) }),
    ...(headers.length && { headers }),
    ...(body && { body }),
    ...(Object.keys(secrets).length && { secrets }),
  };
  if (headers.length) notes.push(`Kept ${headers.length === 1 ? '1 header' : `${headers.length} headers`} under Keys and sign-in: yours only, the model never sees their values.`);
  if (user !== undefined && url.userinfo !== undefined) notes.push('The user and password in the URL became an Authorization header.');
  if (http.secrets) notes.push(`What looks like a key became a saved value (${Object.keys(http.secrets).join(', ')}): sent only to its site; a tool with one asks you every time it runs.`);
  if (cookieHeader || parts.cookies) notes.push("Its cookies were left out: if it needs your sign-in, tick \"Send the browser's session for this site\" under Keys and sign-in.");
  return { http, notes };
}

// name=value&… (a query, a form body) with each credential's value made a saved value.
function secretPairs(text: string, keep: (name: string, written: string) => string): string {
  const pairs = queryPairs(text).map((p) => {
    if (!p.hasValue || !p.raw || /[{}]/.test(p.raw) || !isCredential(p.name, decode(p.raw))) return p;
    return { ...p, raw: `{{secret:${keep(p.name, p.raw)}}}` };
  });
  return joinQuery(pairs);
}

// A JSON body with each credential (at any depth) made a saved value: a text in its quotes, a number
// alone; the rest as it was written. Not JSON: as it came.
function secretJson(body: string, keep: (name: string, written: string) => string): string {
  const spots = scanJsonTemplate(body);
  if (!spots) return body;
  let out = body;
  // From the end, so that the places before stay right.
  for (const spot of [...spots].reverse()) {
    if (spot.kind !== 'string' && spot.kind !== 'number') continue;
    const key = spot.path.findLast((k): k is string => typeof k === 'string') ?? 'key';
    const text = spot.kind === 'string' ? (JSON.parse(spot.raw) as string) : spot.raw;
    const byName = typeof spot.path.at(-1) === 'string' && isCredential(key, text);
    if (!text || !(byName || (spot.kind === 'string' && isCredentialValue(text)))) continue;
    const name = keep(key, spotInner(spot));
    out = replaceSpot(out, spot, spot.kind === 'string' ? `"{{secret:${name}}}"` : `{{secret:${name}}}`);
  }
  return out;
}
