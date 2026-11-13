import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { fakeEvent } from './fakes/browser';

// The recording without the DevTools engine: what the browser tells of the tab's requests
// (webRequest), with the answers the page's hooks tell.
type Sent = { requestId: string; method: string; url: string; type: string; frameId: number; requestBody?: { raw?: { bytes?: ArrayBuffer }[] } };
const filters: { urls: string[]; tabId: number; types: string[] }[] = [];
const requestEvent = <L extends (...a: never[]) => unknown>() => {
  const e = fakeEvent<L>();
  return { ...e, addListener: (l: L, filter?: { urls: string[]; tabId: number; types: string[] }) => { if (filter) filters.push(filter); e.addListener(l); } };
};
const onBeforeRequest = requestEvent<(d: Sent) => void>();
const onCompleted = requestEvent<(d: { requestId: string; statusCode: number }) => void>();
const onErrorOccurred = requestEvent<(d: { requestId: string; error: string }) => void>();
const onUpdated = fakeEvent<(id: number, change: { status?: string; url?: string }) => void>();
const onRemoved = fakeEvent<(id: number) => void>();
const onMessage = fakeEvent<(msg: unknown, sender: { tab?: { id: number }; frameId?: number }, reply: (r: unknown) => void) => unknown>();
const executeScript = vi.fn(async (_o: { args?: unknown[] }) => []);
vi.mock('../src/page/access', () => ({ hasAccess: async (url: string) => !url.includes('other.example') }));
vi.mock('wxt/browser', () => ({
  browser: {
    webRequest: { onBeforeRequest, onCompleted, onErrorOccurred },
    tabs: { onUpdated, onRemoved },
    runtime: { onMessage },
    scripting: { executeScript },
  },
}));

const { startWebRequest } = await import('../src/recording/webrequest');
const { SHIPPED_PRESETS } = await import('../src/recording/presets');
const { MAX_RELAY } = await import('../src/recording/recording');
const preset = (id: string) => SHIPPED_PRESETS.find((p) => p.id === id)!;

let out: Record<string, unknown>[] = [];
const calls = () => out.filter((m) => 'call' in m).map((m) => m.call as Record<string, unknown>);
const start = (p = preset('api')) => startWebRequest({ tabId: 1, preset: p, site: 'shop.example.test' }, (m) => out.push(m as Record<string, unknown>));
const sent = (requestId: string, url: string, more: Partial<Sent> = {}) => onBeforeRequest.emit({ requestId, method: 'GET', url, type: 'xmlhttprequest', frameId: 0, ...more });
const bytes = (s: string) => ({ raw: [{ bytes: new TextEncoder().encode(s).buffer as ArrayBuffer }] });
const keyOf = () => String(executeScript.mock.calls[0]![0].args![0]);
// As the page's hooks tell one: its head as JSON, then its body after a line break.
const answer = ({ body, ...head }: Record<string, unknown>, sender = { tab: { id: 1 }, frameId: 0 }) =>
  onMessage.emit({ type: 'recording-answer', key: keyOf(), answer: JSON.stringify(head) + (body === undefined ? '' : `\n${String(body)}`) }, sender, () => undefined);

beforeEach(() => {
  for (const e of [onBeforeRequest, onCompleted, onErrorOccurred, onUpdated, onRemoved, onMessage]) e.listeners.clear();
  filters.length = 0;
  executeScript.mockClear();
  out = [];
});

describe('the webRequest recording', () => {
  it("listens to the tab's requests of the preset's types, and hooks the page", async () => {
    await start(preset('everything'));
    expect(filters[0]).toEqual({ urls: ['<all_urls>'], tabId: 1, types: ['xmlhttprequest', 'main_frame', 'sub_frame', 'script', 'websocket', 'ping'] });
    expect(executeScript.mock.calls[0]![0].args).toEqual([expect.stringMatching(/^ba-rec-/), MAX_RELAY]);
    expect(executeScript.mock.calls[1]![0].args).toEqual([expect.stringMatching(/^ba-rec-/), expect.any(Number)]);
  });
  it('leaves out what API calls does not keep, only counted', async () => {
    await start();
    sent('1', 'https://shop.example.test/collect');
    sent('2', 'https://shop.example.test/api/items');
    expect(calls().map((c) => c.url)).toEqual(['https://shop.example.test/api/items']);
    expect(out).toContainEqual({ leftOut: 1 });
  });
  it('a WebSocket is a WS call', async () => {
    await start();
    sent('w', 'wss://shop.example.test/live', { type: 'websocket' });
    expect(calls()[0]).toMatchObject({ method: 'WS', url: 'wss://shop.example.test/live' });
  });
  it('stops at 100 kept calls; left-out ones never end it', async () => {
    await start();
    for (let i = 0; i < 150; i++) sent(`n${i}`, `https://shop.example.test/collect?i=${i}`);
    expect(out.some((m) => 'ended' in m)).toBe(false);
    for (let i = 0; i < 101; i++) sent(`k${i}`, `https://shop.example.test/api/${i}`);
    expect(calls()).toHaveLength(100);
    expect(out.at(-1)).toEqual({ ended: 'it reached 100 calls' });
  });
  it("cuts what was sent at the preset's size, secrets hidden first", async () => {
    await start({ ...preset('api'), maxBody: 1000 });
    sent('p', 'https://shop.example.test/api/login', { method: 'POST', requestBody: bytes(JSON.stringify({ password: 'pw-secret', text: 'y'.repeat(5000) })) });
    const body = String(calls()[0]!.requestBody);
    expect(body).toHaveLength(1000);
    expect(body).not.toContain('pw-secret');
  });
  it("adds the page's answer; drops a call whose answer the preset does not keep", async () => {
    await start();
    sent('a', 'https://shop.example.test/api/items');
    sent('b', 'https://shop.example.test/api/logo');
    onCompleted.emit({ requestId: 'a', statusCode: 200 });
    answer({ method: 'GET', url: 'https://shop.example.test/api/items', status: 200, type: 'application/json', body: '{"items":[],"token":"t0k"}' });
    answer({ method: 'GET', url: 'https://shop.example.test/api/logo', status: 200, type: 'image/png' });
    const update = out.find((m) => 'update' in m && (m.update as { responseBody?: string }).responseBody) as { update: { id: string; responseBody: string } };
    expect(update.update.id).toBe('a');
    expect(update.update.responseBody).not.toContain('t0k');
    expect(out).toContainEqual({ drop: 'b' });
    expect(out).toContainEqual({ leftOut: 1 });
  });
  it("another tab's answer is not taken", async () => {
    await start();
    sent('a', 'https://shop.example.test/api/items');
    answer({ method: 'GET', url: 'https://shop.example.test/api/items', status: 200, type: 'application/json', body: '{}' }, { tab: { id: 2 }, frameId: 0 });
    expect(out.some((m) => 'update' in m)).toBe(false);
  });
  it('errors only keeps a failure', async () => {
    await start(preset('errors'));
    sent('ok', 'https://shop.example.test/api/ok');
    sent('bad', 'https://shop.example.test/api/bad');
    onCompleted.emit({ requestId: 'ok', statusCode: 200 });
    onErrorOccurred.emit({ requestId: 'bad', error: 'net::ERR_FAILED' });
    expect(out).toContainEqual({ drop: 'ok' });
    expect(out).not.toContainEqual({ drop: 'bad' });
  });
  it('ends when the tab is closed, or at its time', async () => {
    vi.useFakeTimers();
    try {
      await start({ ...preset('api'), maxMinutes: 1 });
      await vi.advanceTimersByTimeAsync(60_000);
      expect(out).toContainEqual({ ended: 'it reached 1 minutes' });
    } finally {
      vi.useRealTimers();
    }
    out = [];
    await start();
    onRemoved.emit(1);
    expect(out).toContainEqual({ ended: 'the tab was closed' });
  });
  it('a stop lets everything go', async () => {
    const r = await start();
    await r.stop();
    expect(onBeforeRequest.listeners.size + onCompleted.listeners.size + onUpdated.listeners.size + onRemoved.listeners.size).toBe(0);
    sent('late', 'https://shop.example.test/api/late');
    expect(calls()).toHaveLength(0);
  });

  it("hides an answer's secrets before cutting it to the preset's size", async () => {
    await start({ ...preset('api'), maxBody: 1000 });
    sent('me', 'https://shop.example.test/api/me');
    answer({ method: 'GET', url: 'https://shop.example.test/api/me', status: 200, type: 'application/json', body: JSON.stringify({ access_token: 'tok-secret-123', profile: 'x'.repeat(1500) }) });
    const update = out.find((m) => 'update' in m && (m.update as { responseBody?: string }).responseBody) as { update: { responseBody: string } };
    expect(update.update.responseBody.length).toBeLessThanOrEqual(1000);
    expect(update.update.responseBody).not.toContain('tok-secret-123');
    expect(executeScript.mock.calls[0]![0].args).toEqual([expect.any(String), MAX_RELAY]); // the page tells it whole, up to MAX_RELAY
  });
  it('a call dropped at its answer is not remembered: the same call failing later is kept', async () => {
    await start(preset('errors'));
    sent('1', 'https://shop.example.test/api/poll');
    onCompleted.emit({ requestId: '1', statusCode: 200 });
    sent('2', 'https://shop.example.test/api/poll');
    expect(calls().map((c) => c.id)).toEqual(['1', '2']);
  });
  it('stops when the tab goes to a site without access', async () => {
    await start();
    onUpdated.emit(1, { url: 'https://other.example.test/' });
    await new Promise((r) => setTimeout(r, 0));
    expect(out).toContainEqual({ ended: 'no access to other.example.test' });
  });
});

describe('compressed and binary bodies', () => {
  const raw = (b: Uint8Array) => ({ raw: [{ bytes: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }] });
  const bodyOf = (id: string) => {
    const update = out.filter((m) => 'update' in m && (m.update as { id: string; requestBody?: string }).id === id && (m.update as { requestBody?: string }).requestBody !== undefined).at(-1) as { update: { requestBody: string } } | undefined;
    return update?.update.requestBody ?? calls().find((c) => c.id === id)?.requestBody;
  };

  it("unpacks a gzip'd post, known by its first bytes, and hides its password", async () => {
    await start();
    sent('gz', 'https://shop.example.test/api/items', { method: 'POST', requestBody: raw(gzipSync(JSON.stringify({ name: 'Echidna', password: 'hunter2' }))) });
    expect(calls()).toHaveLength(1); // kept at once, its body coming once unpacked
    await vi.waitFor(() => expect(bodyOf('gz')).toBeDefined());
    expect(JSON.parse(String(bodyOf('gz')))).toEqual({ name: 'Echidna', password: '••••' });
    expect(JSON.stringify(out)).not.toContain('hunter2');
  });
  it('a multipart login post (raw bytes) has its password part hidden', async () => {
    await start();
    const form = '--b1\r\nContent-Disposition: form-data; name="user"\r\n\r\nann\r\n--b1\r\nContent-Disposition: form-data; name="password"\r\n\r\nhunter2\r\n--b1--\r\n';
    sent('m', 'https://shop.example.test/api/login', { method: 'POST', requestBody: bytes(form) });
    expect(String(calls()[0]!.requestBody)).toContain('name="user"\r\n\r\nann');
    expect(String(calls()[0]!.requestBody)).not.toContain('hunter2');
  });
  it('a binary post is (binary, N bytes)', async () => {
    await start();
    sent('bin', 'https://shop.example.test/api/upload', { method: 'POST', requestBody: raw(new Uint8Array([0x08, 0x96, 0x01, 0xff, 0x00])) });
    expect(bodyOf('bin')).toBe('(binary, 5 bytes)');
  });
  it('the same packed post again is kept once', async () => {
    await start();
    const packed = gzipSync('{"q":"lamp"}');
    sent('1', 'https://shop.example.test/api/search', { method: 'POST', requestBody: raw(packed) });
    sent('2', 'https://shop.example.test/api/search', { method: 'POST', requestBody: raw(packed) });
    expect(calls().map((c) => c.id)).toEqual(['1']);
  });
  it("an answer the page read as text but is not is binary", async () => {
    await start();
    sent('a', 'https://shop.example.test/api/blob');
    answer({ method: 'GET', url: 'https://shop.example.test/api/blob', status: 200, type: 'text/plain', body: '\u0008\u0012\u0004lamp' });
    const update = out.find((m) => 'update' in m && (m.update as { responseBody?: string }).responseBody) as { update: { responseBody: string } };
    expect(update.update.responseBody).toBe('(binary, 7 bytes)');
  });
});

describe('an answer the page tells for a call the browser did not see', () => {
  it('is dropped before its body is read: the page cannot make the extension parse what it likes', async () => {
    await start();
    sent('a', 'https://shop.example.test/api/items');
    const parsed = vi.spyOn(JSON, 'parse');
    answer({ method: 'POST', url: 'https://shop.example.test/api/not-seen', status: 200, type: 'application/json', body: '{"token":"made-up"}' });
    answer({ method: 'GET', url: 'https://shop.example.test/api/items', status: 200, type: 'application/json', body: '{"id":1,"token":"real"}' });
    const bodies = parsed.mock.calls.map((c) => String(c[0]));
    parsed.mockRestore();
    expect(bodies.some((b) => b.includes('made-up'))).toBe(false);
    expect(bodies.some((b) => b.includes('real'))).toBe(true);
    expect(out.filter((m) => 'update' in m && (m.update as { responseBody?: string }).responseBody)).toHaveLength(1);
  });
});

describe("an answer the page had to cut", () => {
  it('a JSON too large to check for secrets is not shown', async () => {
    await start();
    sent('a', 'https://shop.example.test/api/export');
    answer({ method: 'GET', url: 'https://shop.example.test/api/export', status: 200, type: 'application/json', body: `{"access_token":"tok-secret-123","rows":["${'r'.repeat(5000)}`, cut: true });
    const update = out.find((m) => 'update' in m && (m.update as { responseBody?: string }).responseBody) as { update: { responseBody: string } };
    expect(update.update.responseBody).toBe(`(JSON, over ${MAX_RELAY} characters: too large to check for secrets)`);
  });
  it('other text, cut, is kept as it is', async () => {
    await start(preset('everything'));
    sent('h', 'https://shop.example.test/page');
    answer({ method: 'GET', url: 'https://shop.example.test/page', status: 200, type: 'text/html', body: '<html>' + 'p'.repeat(30_000), cut: true });
    const update = out.find((m) => 'update' in m && (m.update as { responseBody?: string }).responseBody) as { update: { responseBody: string } };
    expect(update.update.responseBody).toMatch(/^<html>p+$/);
  });
});
