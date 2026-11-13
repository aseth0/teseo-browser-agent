// A recording of a tab's requests (the toolbar popup's Record line): what the browser saw the page call
// (fetch and XHR), with the answers the page got, for the model to build a tool that makes the same calls. The
// user reviews it before it goes: calls left out, values hidden. Header values and cookies are never
// kept; values under a secret-looking key are hidden as they come in.
import type { RecordedStep } from './step-types';
import type { VariableEdit } from './variables';

export const MAX_CALLS = 100; // the recording stops at this many
export const MAX_BODY = 20_000; // characters kept of each request and answer
// A body read whole before it is cut to MAX_BODY, so that its secrets are hidden in all of it: a JSON
// cut first could no longer be read to hide them. MAX_READ: one unpacked here (recording/bodies);
// MAX_RELAY: one the page's hooks tell (recording/page-hooks), serialized on the page's own thread and
// sent as a message, so smaller; MAX_HEAD: an answer's head (its method, URL, status and type).
export const MAX_READ = 1_000_000;
export const MAX_RELAY = 200_000;
export const MAX_HEAD = 10_000;
export const MAX_MS = 5 * 60_000; // and after this long
export const HIDDEN = '••••';
// The message "Make a tool…" leaves in the message box, for the user to send or change.
export const MAKE_TOOL_MESSAGE =
  'Create a script tool that makes the calls of this recording: the variables marked as parameters are its inputs, the rest as the recording says. Show me the tool before saving it.';

export interface RecordedCall {
  id: string; // the browser's request id
  method: string;
  url: string;
  at: number;
  status?: number; // none: no answer (yet, or it failed: `error`)
  error?: string;
  requestBody?: string;
  responseBody?: string; // none: the page's answer was not seen (binary, or before the page was hooked)
  responseType?: string;
  included: boolean; // ticked in the review
  // Recorded through DevTools (recording/devtools): its tab, the names of the headers it sent (never their
  // values), and for a WebSocket (method WS) its text frames.
  tabId?: number;
  headerNames?: string[];
  frames?: { dir: 'sent' | 'got'; text: string }[];
}

export interface Recording {
  tabId: number;
  site: string; // the tab's host when it started
  startedAt: number;
  endedAt?: number;
  stopped?: string; // why it stopped by itself
  calls: RecordedCall[];
  mode?: 'tab' | 'tabs' | 'tabs-mouse'; // through DevTools (recording/devtools): what it followed
  notes?: string[]; // what it says about itself: tabs not recorded, how it ended
  steps?: RecordedStep[]; // tabs-and-mouse: what the user did (content/steps)
  hidden: string[]; // values the user hid, everywhere
  hiddenNames?: Record<string, string>; // a hidden value's name (value → name): shown as ••••[name], for a tool's {{secret:name}}
  vars?: Record<string, VariableEdit>; // what the user changed of the variables found, by value
  tool?: boolean; // attached with Make a tool…: its variables go with it (recording/block)
  preset?: string; // the name of the preset it recorded with (recording/presets)
  leftOut?: number; // the calls that preset left out: only counted, never kept
}

// A key whose value is a secret: never kept.
export const SECRET_KEY = /pass(word|wd)?|token|secret|authori[sz]ation|csrf|xsrf|session|api[-_]?key|cookie|credential/i;

// A page's fields that hold secrets, as screenshots mask them (content/mask) and recorded steps leave
// out their text (content/steps): passwords, card and one-time-code fields, and fields named like secrets.
export const SECRET_FIELDS = 'input[type=password], [autocomplete=current-password], [autocomplete=new-password], [autocomplete=one-time-code], [autocomplete^=cc-]';
export const namedLike = (el: Element, re: RegExp) => ['name', 'id', 'autocomplete'].some((a) => re.test(el.getAttribute(a) ?? ''));

// A hidden value as the model sees it: ••••, or ••••[name] for a tool's {{secret:name}}.
export const hiddenLabel = (name?: string) => (name ? `${HIDDEN}[${name}]` : HIDDEN);

// A form body as a page sends it: a=1&b=2.
export const FORM_BODY = /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/;

// A body with the values of its secret-looking keys hidden: JSON, a form (a=1&b=2), a multipart form
// (by each part's name), or JSON line by line (NDJSON, the data: payloads of SSE); any other text as it
// is. `type`: its Content-Type, for a multipart boundary (read from the first line without it).
export function hideSecrets(body: string, type?: string): string {
  const trimmed = body.trim();
  if (/^[[{]/.test(trimmed)) {
    try {
      return JSON.stringify(hideInJson(JSON.parse(trimmed)));
    } catch {
      // not one JSON: maybe one per line
    }
  }
  if (FORM_BODY.test(trimmed)) return hideInQuery(trimmed);
  const boundary = boundaryOf(body, type);
  if (boundary) return mapMultipart(body, boundary, (name, value) => (SECRET_KEY.test(name) ? HIDDEN : value));
  if (body.includes('\n')) return body.split('\n').map(hideInLine).join('\n');
  return body;
}

// A line of NDJSON, or an SSE `data:` line: its JSON hidden; any other line as it is.
const JSON_LINE = /^(data:\s*)?(?=[[{])/;
function hideInLine(line: string): string {
  const m = JSON_LINE.exec(line);
  if (!m) return line;
  const end = /\r$/.test(line) ? '\r' : '';
  const json = line.slice(m[0].length, line.length - end.length);
  try {
    return m[0] + JSON.stringify(hideInJson(JSON.parse(json))) + end;
  } catch {
    return line;
  }
}
export const jsonOfLine = (line: string): string | undefined => {
  const m = JSON_LINE.exec(line);
  return m ? line.slice(m[0].length).replace(/\r$/, '') : undefined;
};

// A multipart body's boundary: from its Content-Type, or from its first line (--boundary) when it
// has parts (Content-Disposition); none: not multipart.
function boundaryOf(body: string, type?: string): string | undefined {
  const typed = type && /boundary="?([^";]+)"?/i.exec(type)?.[1]?.trim();
  if (typed) return body.includes(`--${typed}`) ? typed : undefined;
  const first = /^--([^\r\n]+)\r?\n/.exec(body)?.[1];
  return first && /content-disposition:/i.test(body) ? first : undefined;
}
// The body with each part's value (not a file's content) mapped, by its name; what is not a part
// (the preamble, the closing boundary) as it is.
function mapMultipart(body: string, boundary: string, f: (name: string, value: string) => string): string {
  const mark = `--${boundary}`;
  return body.split(mark).map((piece, i, all) => {
    if (i === 0 || i === all.length - 1) return piece;
    const part = partOf(piece);
    return part && !part.file ? part.head + f(part.name, part.value) + part.tail : piece;
  }).join(mark);
}
// A part between two boundaries: its headers (to the blank line), its value, the line break before the next boundary.
function partOf(piece: string): { head: string; name: string; file: boolean; value: string; tail: string } | undefined {
  const blank = /\r?\n\r?\n/.exec(piece);
  if (!blank) return undefined;
  const head = piece.slice(0, blank.index + blank[0].length);
  const rest = piece.slice(head.length);
  const tail = /\r?\n$/.exec(rest)?.[0] ?? '';
  return { head, name: /\bname="([^"]*)"/i.exec(head)?.[1] ?? '', file: /\bfilename=/i.test(head), value: rest.slice(0, rest.length - tail.length), tail };
}
// A multipart body's parts (files left out), as a form's pairs; none when it is not multipart.
export function multipartPairs(body: string, type?: string): [string, string][] | undefined {
  const boundary = boundaryOf(body, type);
  if (!boundary) return undefined;
  const out: [string, string][] = [];
  mapMultipart(body, boundary, (name, value) => (out.push([name, value]), value));
  return out;
}
// Text with named parts (name="…") that is none of the bodies read above: the review cannot check it.
export const NAMED_PARTS = /\bname="[^"]+"/;

const hideInJson = (v: unknown): unknown => {
  if (Array.isArray(v)) return v.map(hideInJson);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, SECRET_KEY.test(k) ? HIDDEN : hideInJson(x)]));
  return v;
};
const decoded = (k: string) => {
  try {
    return decodeURIComponent(k);
  } catch {
    return k; // a % that is no escape (a cut JSON can look like a form)
  }
};
const hideInQuery = (q: string) =>
  q.split('&').map((pair) => {
    const [k = '', ...rest] = pair.split('=');
    return SECRET_KEY.test(decoded(k)) ? `${k}=${HIDDEN}` : [k, ...rest].join('=');
  }).join('&');

// A URL with its secret-looking query values hidden.
export function hideSecretsInUrl(url: string): string {
  try {
    const u = new URL(url);
    for (const k of [...u.searchParams.keys()]) if (SECRET_KEY.test(k)) u.searchParams.set(k, HIDDEN);
    return u.href.replaceAll(encodeURIComponent(HIDDEN), HIDDEN);
  } catch {
    return url;
  }
}

// What the page said it got for a call, paired with the one the browser saw: the same method and URL,
// the first not answered yet (among those `madeBy` the frame that tells it). What the browser did not
// see is dropped: the page cannot add calls.
export interface PageAnswer {
  method: string;
  url: string;
  status: number;
  type?: string;
  body?: string;
  cut?: boolean; // the page cut the body at MAX_RELAY
}
// An answer as the page's hooks tell it (recording/page-hooks): its head as JSON, a line break, its
// body. None when the head is not one (the page can fire the event itself): nothing of the body is read.
export function parsePageAnswer(detail: string): PageAnswer | undefined {
  const nl = detail.indexOf('\n');
  const head = nl < 0 ? detail : detail.slice(0, nl);
  if (head.length > MAX_HEAD) return undefined;
  let a: Partial<PageAnswer>;
  try {
    a = JSON.parse(head) as Partial<PageAnswer>;
  } catch {
    return undefined;
  }
  if (!a || typeof a !== 'object' || typeof a.method !== 'string' || typeof a.url !== 'string' || typeof a.status !== 'number') return undefined;
  const { method, url, status } = a;
  return { method, url, status, ...(typeof a.type === 'string' && { type: a.type }), ...(a.cut === true && { cut: true }), ...(nl >= 0 && { body: detail.slice(nl + 1) }) };
}
// The call an answer is for; none when the browser saw no such call.
export function answerIndex(calls: RecordedCall[], answer: PageAnswer, madeBy: (c: RecordedCall) => boolean = () => true): number {
  const url = hideSecretsInUrl(answer.url.split('#')[0]!); // as the call was kept
  return calls.findIndex((c) => madeBy(c) && c.method === answer.method.toUpperCase() && c.url === url && c.responseBody === undefined && (c.status === undefined || c.status === answer.status));
}
export function withAnswer(calls: RecordedCall[], answer: PageAnswer, madeBy: (c: RecordedCall) => boolean = () => true): RecordedCall[] {
  const i = answerIndex(calls, answer, madeBy);
  if (i < 0) return calls;
  const body = answer.body === undefined ? undefined : hideSecrets(answer.body, answer.type).slice(0, MAX_BODY);
  return calls.map((c, j) => (j === i ? { ...c, status: c.status ?? answer.status, responseBody: body, responseType: answer.type } : c));
}

// The calls ticked in the review: those that go to the model.
export const recordedCalls = (r: Recording) => r.calls.filter((c) => c.included);

// The recording with a value hidden everywhere (URLs and bodies), or shown again.
export const hideValue = (r: Recording, value: string): Recording => (value && !r.hidden.includes(value) ? { ...r, hidden: [...r.hidden, value] } : r);
export const showValue = (r: Recording, value: string): Recording => ({ ...r, hidden: r.hidden.filter((v) => v !== value) });
// A named hidden value shows as ••••[name], so the model can ask for it as {{secret:name}}.
export const withHidden = (s: string, hidden: string[], names: Record<string, string> = {}) =>
  hidden.reduce((out, v) => out.split(v).join(hiddenLabel(names[v])), s);

// A call's URL as the review and the model read it: the path and query on the recorded site, the
// whole URL elsewhere.
export function shownUrl(url: string, site: string): string {
  try {
    const u = new URL(url);
    return u.host === site ? u.pathname + u.search : u.href;
  } catch {
    return url;
  }
}

// A body laid out to read: JSON indented, anything else as it is.
export function prettyBody(body: string): string {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}
