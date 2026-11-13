// A recorded body as text, for the review and the model (recording/devtools, recording/webrequest): what
// a page sent compressed (by its Content-Encoding, or gzip and zlib known by their first bytes) unpacked
// first, then its secrets hidden in the whole body before it is cut (recording.ts); what is not text
// shows as (binary, N bytes), never as garbled characters.
import { hideSecrets, MAX_READ } from './recording';

export const MAX_UNPACKED = MAX_READ; // bytes a compressed body may unpack to: past it, none of it is shown

// What the browser unpacks each coding as (DecompressionStream); deflate is zlib-wrapped, or raw from some servers.
const FORMATS: Record<string, string[]> = { gzip: ['gzip'], 'x-gzip': ['gzip'], deflate: ['deflate', 'deflate-raw'], br: ['brotli'] };
const BINARY_TYPE = /protobuf|grpc|octet-stream|msgpack|cbor|^(image|audio|video|font)\/|\/(x-)?(zip|gzip|pdf|wasm)\b/i;

const binary = (n: number) => `(binary, ${n} bytes)`;
// Control characters other than tabs and line breaks: no page sends them as text.
const control = (s: string) => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 9 || (c > 13 && c < 32) || c === 127) return true;
  }
  return false;
};

// A body DevTools or the page gave as text (one character a byte when it was not UTF-8); `type`: its
// Content-Type, for a multipart form's boundary.
export const bodyText = (text: string, max: number, type?: string) => (control(text) ? binary(text.length) : hideSecrets(text, type).slice(0, max));

// Bytes as UTF-8 text; `sent`: how many bytes the page sent, for one unpacked here.
export function bytesText(bytes: Uint8Array, o: { type?: string; max: number }, sent = bytes.length): string {
  if (o.type && BINARY_TYPE.test(o.type)) return binary(sent);
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return binary(sent);
  }
  return control(text) ? binary(sent) : hideSecrets(text, o.type).slice(0, o.max);
}

const gzipped = (b: Uint8Array) => b[0] === 0x1f && b[1] === 0x8b;
const zlibbed = (b: Uint8Array) => b.length > 1 && (b[0]! & 0x0f) === 8 && b[0]! >> 4 <= 7 && ((b[0]! << 8) | b[1]!) % 31 === 0;

// The codings to undo, last applied first: by the Content-Encoding header's value (read, never kept),
// else by the body's first bytes. None: the body is read as it is.
export function packing(bytes: Uint8Array, encoding?: string): string[] | undefined {
  const codings = (encoding ?? '').toLowerCase().split(',').map((c) => c.trim()).filter((c) => c && c !== 'identity').reverse();
  if (codings.length) return codings;
  if (gzipped(bytes)) return ['gzip'];
  if (zlibbed(bytes)) return ['deflate'];
  return undefined;
}

const supported = (format: string) => {
  try {
    new DecompressionStream(format as CompressionFormat);
    return true;
  } catch {
    return false;
  }
};

export const joined = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

export const fromBase64 = (data: string) => {
  const raw = atob(data);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
};

// Unpacked as it streams, given up past `cap` bytes (a decompression bomb). Throws when it is not of that format.
async function unpack(bytes: Uint8Array, format: string, cap: number): Promise<Uint8Array | 'too large'> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream(format as CompressionFormat)).getReader();
  const parts: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return joined(parts);
    size += value.length;
    if (size > cap) {
      void reader.cancel().catch(() => undefined);
      return 'too large';
    }
    parts.push(value);
  }
}

// A body packed with `codings` (packing), unpacked and read. One that does not unpack is read as it came.
export async function unpackedText(bytes: Uint8Array, codings: string[], o: { type?: string; max: number }): Promise<string> {
  let out = bytes;
  for (const coding of codings) {
    const formats = (FORMATS[coding] ?? []).filter(supported);
    if (!formats.length) return `(${coding}, ${bytes.length} bytes: cannot be unpacked here)`;
    let next: Uint8Array | 'too large' | undefined;
    for (const format of formats) {
      next = await unpack(out, format, MAX_UNPACKED).catch(() => undefined);
      if (next) break;
    }
    if (next === 'too large') return `(${coding}, ${bytes.length} bytes: too large to unpack)`;
    if (!next) return bytesText(bytes, o);
    out = next;
  }
  return bytesText(out, o, bytes.length);
}

// Any body as bytes: unpacked if packed, then read.
export async function readBody(bytes: Uint8Array, o: { encoding?: string; type?: string; max: number }): Promise<string> {
  const codings = packing(bytes, o.encoding);
  return codings ? unpackedText(bytes, codings, o) : bytesText(bytes, o);
}

// A packed body's stand-in for the preset's dedupe until it is unpacked: its size and a hash of its bytes.
export function packedKey(bytes: Uint8Array): string {
  let h = 0x811c9dc5;
  for (const b of bytes) h = Math.imul(h ^ b, 0x01000193);
  return `(packed, ${bytes.length} bytes, ${(h >>> 0).toString(16)})`;
}

// What a request sent, as the engines keep it: `requestBody` now when it is text (or binary, said so);
// a packed body has instead `sameAs`, its stand-in for the preset's dedupe, and `unpacked`, its text once
// unpacked, to update the call with. `raw`: a form or text as DevTools or the page gave it, else the bytes.
export function sentBodyOf(raw: string | Uint8Array | undefined, how: { encoding?: string; type?: string; max: number }): { requestBody?: string; sameAs?: string; unpacked?: Promise<string> } {
  const bytes = typeof raw === 'string' ? undefined : raw;
  const codings = bytes && packing(bytes, how.encoding);
  if (bytes && codings) return { sameAs: packedKey(bytes), unpacked: unpackedText(bytes, codings, how) };
  const requestBody = bytes ? bytesText(bytes, how) : typeof raw === 'string' ? bodyText(raw, how.max, how.type) : undefined;
  return { requestBody, sameAs: requestBody };
}
