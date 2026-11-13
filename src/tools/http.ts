// The "HTTP request" base of custom tools (tools/custom/runtime): a request whose URL and body are templates
// filled with the tool's own parameters ({name}: URL-encoded in the URL, JSON in the body), with
// headers (the user's, from Settings, whose values stay out of the model's sight; or the model's,
// without secrets, reviewed by the user in the save card), maybe the browser's session for the API's
// site (its cookies, ticked by the user or proposed by the model and reviewed the same way: no key
// needed; a header may carry one of them, {{cookie:NAME}}, the CSRF token some APIs want on a POST),
// and the JSON answer maybe cut to a path ("items[].title"). GET reads; any other method writes,
// confirmed like a site action on the API's host. The answer goes to the model as untrusted.
import { fillSecrets, maskSecrets, neutralizeSecrets } from './secrets';
import { browser } from 'wxt/browser';
import { wrappedResultMax } from '../core/limits';
import { cutAndKeep } from '../core/kept-results';
import { markValue, text } from '../core/model-texts';
import type { Tool, ToolResult } from '../core/types';
import { requireAccess } from '../page/access';
import { isObject } from '../core/util';
import type { CustomTool } from './custom/types';
import { fillTemplate, inputValues } from './custom/values';

export const HTTP_BASE = 'http';
export const HTTP_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;

export interface HttpRequest {
  method: (typeof HTTP_METHODS)[number];
  url: string; // template: "https://api.example.com/search?q={query}"
  headers?: { name: string; value: string }[]; // the user's values are never shown to the model; the model's are reviewed in the save card
  body?: string; // JSON template: {"name": {name}} (not for GET)
  extract?: string; // a path into the JSON answer: "items[].title", "data.0.name", "[].{id,name}"
  session?: boolean; // send the browser's cookies for the API's site; set by the user, or proposed by the model and reviewed
  readOnly?: boolean; // a request other than GET that only reads (a search sent as POST); set by the user only
  secrets?: Record<string, string>; // values saved for its {{secret:name}} (tools/secrets); set by the user only, never shown to the model
}

// What a header's name may be (RFC 9110 token): "X-CSRF-Token", never "X-CSRF-Token: …".
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
export const headerNameProblem = (name: string) =>
  HEADER_NAME.test(name) ? undefined : `"${name}" is not a header name: letters, digits and - only (its value goes in the box beside it).`;

// The host ends where the path, query or fragment starts, with no placeholder in it: a value can
// never change where the request goes (https://api.example.com{sub}/v1 has no fixed host).
export const hasFixedHost = (url: string) => /^https?:\/\/[^/{}?#]+(?=[/?#]|$)/i.test(url.trim());

// A redirect is never followed: the site is checked on the URL asked only, and a redirect would take
// the headers (keys), the session and the body to wherever it leads. The browser does not say where
// ('manual' answers an opaque redirect), so none is, the same site's either.
export const NO_REDIRECT = 'manual' as const;
export function refuseRedirect(res: Response, url: string | URL): void {
  if (res.type === 'opaqueredirect') throw new Error(`${new URL(url).host} answered with a redirect, which is not followed (not even to the same site): use the address it leads to.`);
}

// A header's value taken from a cookie of the API's site: "X-CSRF-Token: {{cookie:MMCSRF}}".
const COOKIE = /\{\{\s*cookie:([^}]+)\}\}/g;
export const cookiesIn = (value: string) => [...value.matchAll(COOKIE)].map((m) => m[1]!.trim());

// The headers with their cookies in, read for the request's URL; or why not (a cookie missing).
async function withCookies(headers: Record<string, string>, url: string): Promise<{ headers: Record<string, string> } | { problem: string }> {
  const values: Record<string, string> = {};
  const names = new Set(Object.values(headers).flatMap(cookiesIn));
  // An extension loaded before it had the permission (not reloaded since).
  if (names.size && !browser.cookies) return { problem: 'A header takes a cookie, but the extension cannot read cookies yet: reload it (in the browser\'s extensions page), then try again.' };
  for (const name of names) {
    const cookie = await browser.cookies.get({ url, name });
    if (!cookie) return { problem: `No ${name} cookie for ${new URL(url).host}: the user must open it in the browser and sign in, then try again.` };
    values[name] = cookie.value;
  }
  return { headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v.replace(COOKIE, (_, name: string) => values[name.trim()]!)])) };
}

// The headers a request sends: the user's (their cookies in, only with the session; saving checks it
// too), and the JSON type of a body; or why it cannot go (a cookie missing). For scripts too.
// The values saved for the tool ({{secret:name}}) go in too, last.
export async function requestHeaders(http: Pick<HttpRequest, 'headers' | 'session' | 'secrets'>, url: string, withBody: boolean): Promise<{ headers: Record<string, string> } | { problem: string }> {
  const given = Object.fromEntries((http.headers ?? []).filter((h) => h.name.trim()).map((h) => [h.name.trim(), fillSecrets(h.value, http.secrets)]));
  const bad = Object.keys(given).map(headerNameProblem).find(Boolean);
  if (bad) return { problem: bad };
  const filled = http.session ? await withCookies(given, url) : { headers: given };
  if ('problem' in filled) return filled;
  if (withBody && !Object.keys(filled.headers).some((h) => h.toLowerCase() === 'content-type')) filled.headers['Content-Type'] = 'application/json';
  return filled;
}

// The URL with the values in it, each URL-encoded (one left out: empty).
export const fillUrl = (template: string, values: Record<string, unknown>) =>
  fillTemplate(template, (name) => encodeURIComponent(values[name] === undefined ? '' : String(values[name])));

// The body with the values in it as JSON ({name} stands for a whole JSON value: no quotes around it).
export const fillBody = (template: string, values: Record<string, unknown>) =>
  fillTemplate(template, (name) => JSON.stringify(values[name] ?? null));

// A path into a JSON value: keys and indexes joined by dots; "[]" after one goes through each element
// of that list ("items[].title"), alone the list itself ("[].name"); "{a,b}" keeps only those keys of
// an object ("[].{id,name}"), leaving out the ones it does not have.
export function extractPath(value: unknown, path: string): unknown {
  const parts = path.split('.').filter(Boolean);
  const walk = (v: unknown, i: number): unknown => {
    if (i === parts.length || v === undefined) return v;
    const part = parts[i]!;
    const keys = /^\{(.*)\}$/.exec(part)?.[1];
    if (keys !== undefined) {
      if (!v || typeof v !== 'object' || Array.isArray(v)) return undefined;
      const picked = keys.split(',').map((k) => k.trim()).filter((k) => k && k in v).map((k) => [k, (v as Record<string, unknown>)[k]]);
      return walk(Object.fromEntries(picked), i + 1);
    }
    const each = part.endsWith('[]');
    const key = each ? part.slice(0, -2) : part;
    const next = key === '' ? v : Array.isArray(v) && /^\d+$/.test(key) ? v[Number(key)] : (v as Record<string, unknown> | null)?.[key];
    if (!each) return walk(next, i + 1);
    return Array.isArray(next) ? next.map((x) => walk(x, i + 1)) : undefined;
  };
  return walk(value, 0);
}

// The answer, read once: as the model gets it (the JSON at the path when there is one, else the text),
// and its value for a tool that runs this one (the JSON at the path, or whole; none when not JSON).
function readAnswer(body: string, extract: string | undefined): { text: string; data?: unknown } {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return { text: body }; // not JSON: as it came
  }
  const path = extract?.trim();
  if (!path) return { text: body, data: json };
  const found = extractPath(json, path);
  return { text: found === undefined ? nothingAt(json, path) : typeof found === 'string' ? found : JSON.stringify(found, null, 1), data: found };
}

// An extract path that finds nothing, with the keys the answer has, to pick another from.
function nothingAt(json: unknown, path: string): string {
  const keysOf = (v: unknown) => (isObject(v) ? Object.keys(v).slice(0, 30).join(', ') : '');
  if (Array.isArray(json)) {
    const keys = keysOf(json[0]);
    return `(nothing at ${path}; the answer is a list of ${json.length}${keys ? `, its first item's keys: ${keys}` : ''})`;
  }
  const keys = keysOf(json);
  return keys ? `(nothing at ${path}; the answer's top-level keys: ${keys})` : `(nothing at ${path})`;
}
export const answerText = (body: string, extract: string | undefined) => readAnswer(body, extract).text;

// The URL and body with the call's values in them.
const requestOf = (custom: CustomTool, args: unknown) => {
  const http = custom.http!;
  const values = inputValues(custom.inputs ?? [], args);
  return { url: fillUrl(http.url, values), body: http.method === 'GET' || !http.body?.trim() ? undefined : fillBody(http.body, values) };
};

// The URL as the model is told it: without its query, which may carry a value the user wrote into
// the template (a key) and never meant for the model.
const urlForModel = (url: string) => {
  const u = new URL(url);
  return `${u.origin}${u.pathname}${u.search ? '?…' : ''}`;
};

// The answer worded for the model.
export const httpResult = (status: number, url: string, answer: string) => text('result.http_response', { status: String(status), url: urlForModel(url), body: markValue(answer, 'tool') });

// Sends the request and words the answer for the model, cut with its whole kept for tools.read_more
// (in `conversationId`'s); the status, URL, answer and whole answer are kept apart too, for the editor's Try.
export async function sendRequest(
  custom: CustomTool,
  args: unknown,
  signal: AbortSignal,
  conversationId?: string,
): Promise<{ status: number; url: string; answer?: string; raw?: string; result: Extract<ToolResult, { type: 'text' }> }> {
  const http = custom.http!;
  const asked = requestOf(custom, neutralizeSecrets(args));
  // The values saved for it ({{secret:name}}) go in last, never seen by the model.
  const url = fillSecrets(asked.url, http.secrets);
  const body = asked.body === undefined ? undefined : fillSecrets(asked.body, http.secrets);
  // Never to another site than the one the user wrote, whatever the values (a tool saved before the
  // URL's host was checked may still have a placeholder in it).
  if (!hasFixedHost(http.url) || new URL(url).origin !== new URL(http.url.trim()).origin) throw new Error(`The request would go to ${new URL(url).host}, not to the tool's own site: not sent.`);
  await requireAccess(url, 'reach');
  const filled = await requestHeaders(http, url, !!body);
  if ('problem' in filled) return { status: 0, url, result: { type: 'text', text: filled.problem, isError: true } };
  const res = await fetch(url, { method: http.method, headers: filled.headers, body, credentials: http.session ? 'include' : 'omit', redirect: NO_REDIRECT, signal });
  refuseRedirect(res, url);
  if (http.session && res.status === 401)
    return { status: 401, url, result: { type: 'text', text: `Not signed in to ${new URL(url).host}: the user must open it in the browser and sign in, then try again.`, isError: true } };
  const raw = maskSecrets(await res.text(), http.secrets);
  const read = readAnswer(raw, http.extract);
  const answer = cutAndKeep(read.text, 'toolResult', { conversationId, source: custom.name, max: wrappedResultMax() });
  const data = res.ok ? read.data : undefined;
  const shown = maskSecrets(url, http.secrets); // a saved value in its URL is not told either
  // `raw`: the whole answer (its saved values masked), for the editor to pick keys from.
  return { status: res.status, url: shown, answer, raw, result: { type: 'text', text: httpResult(res.status, shown, answer), isError: !res.ok, ...(data !== undefined && { data }) } };
}

export function httpTool(custom: CustomTool, inputSchema: Tool['inputSchema']): Tool {
  const http = custom.http!;
  return {
    name: custom.name,
    description: custom.description,
    inputSchema,
    source: 'custom',
    effect: http.method === 'GET' || http.readOnly ? 'read' : 'write',
    // What is sent, without the headers; the site policy is the API's host's.
    describe: async (args) => {
      const { url, body } = requestOf(custom, args);
      const details = [
        ...(body ? [{ label: 'Body', value: body, code: true }] : []),
        ...(http.session ? [{ label: 'Signed in as you', value: `Sends your browser session for ${new URL(url).host}` }] : []),
      ];
      return { summary: `${http.method} ${url}`, url, details: details.length ? details : undefined };
    },
    run: async (args, ctx) => (await sendRequest(custom, args, ctx.signal, ctx.conversationId)).result,
  };
}
