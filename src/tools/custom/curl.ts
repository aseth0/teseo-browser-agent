// A curl command as browsers and API docs copy it (bash, also "curl.exe" and a "$ " prompt), read
// into the parts of a request: method, URL, headers, body. Nothing here decides what is a credential
// (tools/custom/pasted-request does).

export interface CurlParts {
  method?: string;
  url: string;
  headers: { name: string; value: string }[];
  body?: string;
  form?: boolean; // a body of -d without --json: name=value&…
  get?: boolean; // -G: the data goes in the query
  user?: string; // -u user:password
  cookies?: boolean; // -b, or a Cookie header
}

// Options whose value this ignores (where the answer goes, timeouts…). One not listed that takes a
// value cannot take the URL's place: the URL is the first word that starts with http(s)://.
const IGNORED_WITH_VALUE = new Set([
  '-o', '--output', '-A', '--user-agent', '-e', '--referer', '-m', '--max-time', '--connect-timeout', '--retry',
  '-w', '--write-out', '-x', '--proxy', '--cacert', '--cert', '--key', '-c', '--cookie-jar', '-T', '--upload-file',
]);
const DATA = new Set(['-d', '--data', '--data-raw', '--data-binary', '--data-ascii', '--data-urlencode', '--json']);

// The command's words after "curl", or why it is not one.
export function curlWords(command: string): string[] | { problem: string } {
  const words = shellWords(command.trim().replace(/^[$>]\s+/, ''));
  if (!words) return { problem: 'A quote is left open in the command.' };
  if (!/^curl(\.exe)?$/i.test(words[0] ?? '')) return { problem: 'Not a URL (https://…) nor a curl command.' };
  return words.slice(1);
}

export function readCurl(args: string[]): CurlParts | { problem: string } {
  const parts: CurlParts = { url: '', headers: [] };
  const data: string[] = [];
  for (let i = 0; i < args.length; i++) {
    let flag = args[i]!;
    let attached: string | undefined;
    // --header=…, and -XPOST / -HName: value (a short option with its value joined).
    const long = /^(--[a-z-]+)=(.*)$/s.exec(flag);
    if (long) [, flag, attached] = long as unknown as [string, string, string];
    else if (/^-[XHdbu].+/s.test(flag)) [flag, attached] = [flag.slice(0, 2), flag.slice(2)];
    const value = () => attached ?? args[++i] ?? '';
    if (flag === '-X' || flag === '--request') parts.method = value().toUpperCase();
    else if (flag === '-H' || flag === '--header') {
      const h = value();
      const colon = h.indexOf(':');
      if (colon > 0) parts.headers.push({ name: h.slice(0, colon).trim(), value: h.slice(colon + 1).trim() });
    } else if (DATA.has(flag)) {
      data.push(value());
      if (flag === '--json') parts.headers.push({ name: 'Content-Type', value: 'application/json' });
    } else if (flag === '-G' || flag === '--get') parts.get = true;
    else if (flag === '-b' || flag === '--cookie') {
      value();
      parts.cookies = true;
    } else if (flag === '-u' || flag === '--user') parts.user = value();
    else if (flag === '--url') parts.url = value();
    else if (IGNORED_WITH_VALUE.has(flag)) value();
    else if (!parts.url && /^https?:\/\//i.test(flag)) parts.url = flag;
  }
  if (!/^https?:\/\//i.test(parts.url)) return { problem: 'The curl command has no http(s) URL.' };
  if (data.length) {
    parts.body = data.join('&');
    parts.form = data.length > 1 || !/^\s*[[{]/.test(data[0]!);
  }
  return parts;
}

// The words of a shell command: '…' as it is, "…" with \ escapes, $'…' with C escapes (as Chrome's
// "Copy as cURL" writes a body), a backslash before a newline joining lines outside '…'; undefined
// when a quote is left open.
export function shellWords(command: string): string[] | undefined {
  const words: string[] = [];
  let word: string | undefined;
  const add = (s: string) => (word = (word ?? '') + s);
  let i = 0;
  const text = command;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "'") {
      const end = text.indexOf("'", i + 1);
      if (end < 0) return undefined;
      add(text.slice(i + 1, end));
      i = end + 1;
    } else if (c === '$' && text[i + 1] === "'") {
      const read = ansiC(text, i + 2);
      if (!read) return undefined;
      add(read.text);
      i = read.end;
    } else if (c === '"') {
      let j = i + 1;
      let s = '';
      for (; j < text.length && text[j] !== '"'; j++) {
        if (text[j] === '\\' && text[j + 1] === '\n') j++;
        else if (text[j] === '\\' && '"\\$`'.includes(text[j + 1] ?? '')) s += text[++j];
        else s += text[j];
      }
      if (j >= text.length) return undefined;
      add(s);
      i = j + 1;
    } else if (c === '\\') {
      if (text[i + 1] === '\n' || (text[i + 1] === '\r' && text[i + 2] === '\n')) i += text[i + 1] === '\r' ? 3 : 2;
      else {
        add(text[i + 1] ?? '');
        i += 2;
      }
    } else if (/\s/.test(c)) {
      if (word !== undefined) words.push(word);
      word = undefined;
      i++;
    } else {
      add(c);
      i++;
    }
  }
  if (word !== undefined) words.push(word);
  return words;
}

const C_ESCAPES: Record<string, string> = { n: '\n', t: '\t', r: '\r', '\\': '\\', "'": "'", '"': '"', '?': '?', a: '\x07', b: '\b', e: '\x1b', f: '\f', v: '\v' };

// A $'…' string from `start` (after its quote): its text, and where it ends.
function ansiC(text: string, start: number): { text: string; end: number } | undefined {
  let s = '';
  for (let j = start; j < text.length; j++) {
    const c = text[j]!;
    if (c === "'") return { text: s, end: j + 1 };
    if (c !== '\\') {
      s += c;
      continue;
    }
    const e = text[++j] ?? '';
    const hex = e === 'x' ? /^[0-9a-fA-F]{1,2}/.exec(text.slice(j + 1, j + 3))?.[0] : e === 'u' ? /^[0-9a-fA-F]{1,4}/.exec(text.slice(j + 1, j + 5))?.[0] : undefined;
    if (hex) {
      s += String.fromCodePoint(parseInt(hex, 16));
      j += hex.length;
    } else s += C_ESCAPES[e] ?? `\\${e}`;
  }
  return undefined;
}
