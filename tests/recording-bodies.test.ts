import { afterEach, describe, expect, it, vi } from 'vitest';
import { brotliCompressSync, deflateRawSync, deflateSync, gzipSync } from 'node:zlib';
import { bodyText, bytesText, packing, readBody, unpackedText, MAX_UNPACKED } from '../src/recording/bodies';

// A recorded body as the review and the model read it: unpacked when the page sent it compressed,
// secrets hidden, cut; binary as (binary, N bytes), never as garbled text.
const json = JSON.stringify({ user: 'ann@example.com', password: 'hunter2', q: 'lamp' });
const bytes = (b: Buffer | string) => new Uint8Array(typeof b === 'string' ? Buffer.from(b) : b);
const opts = { max: 20_000 };

afterEach(() => vi.unstubAllGlobals());

describe('packing', () => {
  it('follows the Content-Encoding header, in any case, last coding first', () => {
    expect(packing(bytes(gzipSync(json)), 'GZIP')).toEqual(['gzip']);
    expect(packing(bytes(deflateSync(json)), 'deflate')).toEqual(['deflate']);
    expect(packing(bytes('x'), 'gzip, br')).toEqual(['br', 'gzip']);
    expect(packing(bytes(json), 'identity')).toBeUndefined();
  });
  it('without a header, knows gzip and zlib by their first bytes', () => {
    expect(packing(bytes(gzipSync(json)))).toEqual(['gzip']);
    expect(packing(bytes(deflateSync(json)))).toEqual(['deflate']);
    expect(packing(bytes(json))).toBeUndefined();
    expect(packing(bytes('x^ looks like zlib'))).toEqual(['deflate']); // tried, then read as it is (below)
  });
});

describe('unpackedText', () => {
  it("unpacks a gzip'd JSON and hides its password", async () => {
    const body = await unpackedText(bytes(gzipSync(json)), ['gzip'], opts);
    expect(JSON.parse(body)).toEqual({ user: 'ann@example.com', password: '••••', q: 'lamp' });
  });
  it('unpacks deflate, zlib-wrapped or raw', async () => {
    expect(await unpackedText(bytes(deflateSync(json)), ['deflate'], opts)).toContain('"q":"lamp"');
    expect(await unpackedText(bytes(deflateRawSync(json)), ['deflate'], opts)).toContain('"q":"lamp"');
  });
  it('unpacks br where the browser can, and says so where it cannot', async () => {
    const br = bytes(brotliCompressSync(json));
    expect(await unpackedText(br, ['br'], opts)).toContain('"password":"••••"');
    const Real = DecompressionStream;
    vi.stubGlobal('DecompressionStream', class extends Real {
      constructor(format: CompressionFormat) {
        if (String(format) === 'brotli') throw new TypeError('Unsupported compression format');
        super(format);
      }
    });
    expect(await unpackedText(br, ['br'], opts)).toBe(`(br, ${br.length} bytes: cannot be unpacked here)`);
  });
  it('an unknown coding is not guessed at', async () => {
    expect(await unpackedText(bytes('abc'), ['zstd'], opts)).toBe('(zstd, 3 bytes: cannot be unpacked here)');
  });
  it('stops unpacking past its limit, and shows none of it', async () => {
    const bomb = bytes(gzipSync(JSON.stringify({ password: 'hunter2', pad: 'a'.repeat(MAX_UNPACKED * 2) })));
    const body = await unpackedText(bomb, ['gzip'], opts);
    expect(body).toBe(`(gzip, ${bomb.length} bytes: too large to unpack)`);
  });
  it('a body that only looked packed is read as it is', async () => {
    expect(await unpackedText(bytes('x^ looks like zlib'), ['deflate'], opts)).toBe('x^ looks like zlib');
  });
  it('unpacked binary is binary, counted as sent', async () => {
    const packed = bytes(gzipSync(Buffer.from([0, 1, 2, 0xff, 0xfe, 3])));
    expect(await unpackedText(packed, ['gzip'], opts)).toBe(`(binary, ${packed.length} bytes)`);
  });
  it("cuts at the preset's size after hiding", async () => {
    const big = bytes(gzipSync(JSON.stringify({ token: 'tok-secret', pad: 'y'.repeat(5000) })));
    const body = await unpackedText(big, ['gzip'], { max: 1000 });
    expect(body).toHaveLength(1000);
    expect(body).not.toContain('tok-secret');
  });
});

describe('bytesText and bodyText', () => {
  it('UTF-8 text as text, secrets hidden', () => {
    expect(bytesText(bytes('héllo wörld'), opts)).toBe('héllo wörld');
    expect(bytesText(bytes('user=ann&password=hunter2'), opts)).toBe('user=ann&password=••••');
  });
  it('bytes that are not UTF-8 are binary', () => {
    expect(bytesText(new Uint8Array([0x1f, 0x8b, 0xed, 0x58, 0xd9, 0xff]), opts)).toBe('(binary, 6 bytes)');
  });
  it('control characters make it binary (protobuf, a packed body read as text)', () => {
    expect(bytesText(bytes('\u0008\u0012\u0004lamp'), opts)).toBe('(binary, 7 bytes)');
    expect(bodyText('\u001f\u0008\u0000«V*-N-R²', 20_000)).toBe('(binary, 11 bytes)'); // one character a byte, as DevTools gives it
    expect(bodyText('{"a":\n\t"b"}\r\n', 20_000)).toBe('{"a":"b"}');
  });
  it('a binary content type is binary even when it reads as text', () => {
    expect(bytesText(bytes('lamp'), { ...opts, type: 'application/x-protobuf' })).toBe('(binary, 4 bytes)');
    expect(bytesText(bytes('GIF89a'), { ...opts, type: 'image/gif' })).toBe('(binary, 6 bytes)');
    expect(bytesText(bytes('{"a":1}'), { ...opts, type: 'application/json; charset=utf-8' })).toBe('{"a":1}');
  });
});

describe('readBody', () => {
  it('unpacks what the header or the first bytes say, else reads it', async () => {
    expect(await readBody(bytes(gzipSync(json)), opts)).toContain('"password":"••••"');
    expect(await readBody(bytes(deflateRawSync(json)), { ...opts, encoding: 'deflate' })).toContain('"q":"lamp"');
    expect(await readBody(bytes(json), opts)).toContain('"q":"lamp"');
  });
});
