import { beforeEach, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';
import { fakeEvent } from './fakes/browser';

// The recording's hold: a fake per tab, recording what is sent and keeping the listeners.
type Listener = (p: Record<string, unknown>, child?: string) => void;
interface FakeHold { tabId: number; sent: [string, unknown, string | undefined][]; listeners: Map<string, Listener[]>; released: boolean; ended: (why: string) => void }
const holds = new Map<number, FakeHold>();
let refuse: Record<number, string> = {}; // tab → the error its hold fails with
let bodies: Record<string, { body: string; base64Encoded: boolean }> = {};
let posted: Record<string, { postData: string; base64Encoded?: boolean }> = {};
const holdForRecording = vi.fn(async (tabId: number, onEnded: (why: string) => void) => {
  if (refuse[tabId]) throw new Error(refuse[tabId]);
  const h: FakeHold = { tabId, sent: [], listeners: new Map(), released: false, ended: onEnded };
  holds.set(tabId, h);
  return {
    send: async (method: string, params?: Record<string, unknown>, child?: string) => {
      h.sent.push([method, params, child]);
      if (method === 'Network.getResponseBody') return bodies[String(params?.requestId)] ?? { body: '', base64Encoded: false };
      if (method === 'Network.getRequestPostData') return posted[String(params?.requestId)] ?? { postData: '' };
      return {};
    },
    on: (event: string, l: Listener) => h.listeners.set(event, [...(h.listeners.get(event) ?? []), l]),
    release: async () => void (h.released = true),
  };
});
vi.mock('../src/devtools/cdp', () => ({ holdForRecording }));
const pageCalls: { tabId: number; req: { op: string } }[] = [];
vi.mock('../src/page/bridge', () => ({ callPage: vi.fn(async (tabId: number, req: { op: string }) => void pageCalls.push({ tabId, req })) }));

const onActivated = fakeEvent<(info: { tabId: number; windowId: number }) => void>();
const onUpdated = fakeEvent<(tabId: number, change: { url?: string }, tab: { id: number; windowId: number; url?: string; title?: string }) => void>();
let tabs: Record<number, { id: number; windowId: number; url: string; title: string }> = {};
let allowed = new Set<string>();
const onMessage = fakeEvent<(msg: unknown, sender: { tab?: { id: number } }, reply: (r: unknown) => void) => unknown>();
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { onMessage, getURL: (p: string) => `chrome-extension://me${p}` },
    tabs: { get: async (id: number) => tabs[id], onActivated, onUpdated },
    permissions: { contains: async (p: { origins: string[] }) => allowed.has(p.origins[0]!) },
  },
}));

const { startCapture } = await import('../src/recording/devtools');

const emit = (tabId: number, event: string, p: Record<string, unknown>, child?: string) => holds.get(tabId)!.listeners.get(event)?.forEach((l) => l(p, child));
const flush = () => new Promise((r) => setTimeout(r, 0));
let out: Record<string, unknown>[] = [];
const calls = () => out.filter((m) => 'call' in m).map((m) => m.call as Record<string, unknown>);
const updates = () => out.filter((m) => 'update' in m).map((m) => m.update as Record<string, unknown>);

beforeEach(() => {
  // Captures of earlier tests left listening: not this test's.
  onActivated.listeners.clear();
  onUpdated.listeners.clear();
  holds.clear();
  refuse = {};
  bodies = {};
  posted = {};
  out = [];
  tabs = { 1: { id: 1, windowId: 9, url: 'https://shop.example.test/', title: 'Shop' }, 2: { id: 2, windowId: 9, url: 'https://pay.example.test/', title: 'Pay' }, 3: { id: 3, windowId: 9, url: 'https://other.test/', title: 'Other' } };
  allowed = new Set(['https://shop.example.test/*', 'https://pay.example.test/*']);
  holdForRecording.mockClear();
  pageCalls.length = 0;
});

const { SHIPPED_PRESETS } = await import('../src/recording/presets');
const preset = (id: string) => SHIPPED_PRESETS.find((p) => p.id === id)!;
// Everything: what the capture kept before presets.
const start = (mode: 'tab' | 'tabs' | 'tabs-mouse' = 'tab', p = preset('everything')) =>
  startCapture({ tabId: 1, mode, preset: p, site: 'shop.example.test' }, (m) => out.push(m as Record<string, unknown>));

describe('the DevTools capture', () => {
  it('a multipart login post (postDataEntries) has its password part hidden, by the boundary of its Content-Type', async () => {
    await start();
    const form = 'preamble\r\n--b1\r\nContent-Disposition: form-data; name="user"\r\n\r\nann\r\n--b1\r\nContent-Disposition: form-data; name="password"\r\n\r\nhunter2\r\n--b1--\r\n';
    const entries = [{ bytes: btoa(form) }];
    emit(1, 'Network.requestWillBeSent', { requestId: 'm1', type: 'Fetch', request: { method: 'POST', url: 'https://shop.example.test/api/login', headers: { 'Content-Type': 'multipart/form-data; boundary=b1' }, postDataEntries: entries } });
    await flush();
    expect(String(calls()[0]!.requestBody)).toContain('name="user"\r\n\r\nann');
    expect(String(calls()[0]!.requestBody)).not.toContain('hunter2');
  });
  it('turns a fetch into a RecordedCall with both bodies, secrets hidden', async () => {
    await start();
    expect(holds.get(1)!.sent.map((s) => s[0])).toEqual(['Network.enable', 'Target.setAutoAttach']);
    emit(1, 'Network.requestWillBeSent', { requestId: 'r1', type: 'Fetch', request: { method: 'POST', url: 'https://shop.example.test/api/pay?token=abc', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer x' }, postData: '{"password":"hunter2","q":"lamp"}' } });
    emit(1, 'Network.responseReceived', { requestId: 'r1', response: { status: 200, mimeType: 'application/json' } });
    bodies.r1 = { body: '{"ok":true,"session":"s3cr3t"}', base64Encoded: false };
    emit(1, 'Network.loadingFinished', { requestId: 'r1' });
    await flush();
    const [c] = calls();
    expect(c).toMatchObject({ method: 'POST', tabId: 1, included: true, headerNames: ['Content-Type', 'Authorization'] });
    expect(c!.url).not.toContain('abc');
    expect(c!.requestBody).not.toContain('hunter2');
    expect(JSON.stringify(updates())).toContain('"status":200');
    const answer = String(updates().find((u) => u.responseBody)!.responseBody);
    expect(answer).toContain('"ok":true');
    expect(answer).not.toContain('s3cr3t');
    expect(JSON.stringify(out)).not.toContain('Bearer x');
  });

  it('drops static resources before keeping them', async () => {
    await start();
    for (const type of ['Image', 'Font', 'Stylesheet', 'Media', 'Manifest', 'TextTrack']) emit(1, 'Network.requestWillBeSent', { requestId: type, type, request: { method: 'GET', url: `https://shop.example.test/${type}`, headers: {} } });
    emit(1, 'Network.requestWillBeSent', { requestId: 'doc', type: 'Document', request: { method: 'GET', url: 'https://shop.example.test/', headers: {} } });
    expect(calls().map((c) => c.url)).toEqual(['https://shop.example.test/']);
  });

  it("a worker's request is recorded through its child session", async () => {
    await start();
    emit(1, 'Target.attachedToTarget', { sessionId: 'w1', targetInfo: { type: 'worker' } });
    await flush();
    expect(holds.get(1)!.sent.slice(-2)).toEqual([['Network.enable', undefined, 'w1'], ['Runtime.runIfWaitingForDebugger', undefined, 'w1']]);
    emit(1, 'Network.requestWillBeSent', { requestId: 'r9', type: 'Fetch', request: { method: 'GET', url: 'https://shop.example.test/api/worker-data', headers: {} } }, 'w1');
    bodies.r9 = { body: '{"from":"worker"}', base64Encoded: false };
    emit(1, 'Network.loadingFinished', { requestId: 'r9' }, 'w1');
    await flush();
    expect(calls()[0]!.url).toBe('https://shop.example.test/api/worker-data');
    expect(holds.get(1)!.sent.find((s) => s[0] === 'Network.getResponseBody')![2]).toBe('w1');
  });

  it("groups a WebSocket's frames under one call, at most 50", async () => {
    await start();
    emit(1, 'Network.webSocketCreated', { requestId: 'ws1', url: 'wss://shop.example.test/live' });
    for (let i = 0; i < 60; i++) emit(1, i % 2 ? 'Network.webSocketFrameReceived' : 'Network.webSocketFrameSent', { requestId: 'ws1', response: { opcode: 1, payloadData: `m${i}` } });
    expect(calls()).toHaveLength(1);
    expect(calls()[0]).toMatchObject({ method: 'WS', url: 'wss://shop.example.test/live' });
    const frames = updates().filter((u) => u.frames).at(-1)!.frames as unknown[];
    expect(frames).toHaveLength(50);
  });

  it('stops at 100 calls', async () => {
    await start();
    for (let i = 0; i < 101; i++) emit(1, 'Network.requestWillBeSent', { requestId: `r${i}`, type: 'XHR', request: { method: 'GET', url: `https://shop.example.test/${i}`, headers: {} } });
    await flush();
    expect(calls()).toHaveLength(100);
    expect(out.at(-1)).toEqual({ ended: 'it reached 100 calls' });
    expect(holds.get(1)!.released).toBe(true);
  });

  it('skips a tab without access and notes it', async () => {
    await start('tabs');
    onActivated.emit({ tabId: 3, windowId: 9 });
    await flush();
    await flush();
    expect(holds.has(3)).toBe(false);
    expect(out).toContainEqual({ note: 'not recorded: no access to other.test' });
    onActivated.emit({ tabId: 2, windowId: 9 });
    await flush();
    await flush();
    expect(holds.has(2)).toBe(true);
    expect(out).toContainEqual({ step: expect.objectContaining({ tabId: 2, kind: 'tab', target: 'Pay (pay.example.test)' }) });
  });

  it('one tab only in mode tab', async () => {
    await start('tab');
    onActivated.emit({ tabId: 2, windowId: 9 });
    await flush();
    expect(holds.has(2)).toBe(false);
  });

  it('attach failure is shown, nothing recorded', async () => {
    refuse[1] = 'Another debugger is attached to this tab (DevTools open?): close it and try again';
    await start();
    expect(out).toEqual([{ ended: 'Another debugger is attached to this tab (DevTools open?): close it and try again' }]);
  });

  it('a first tab that fails once held is let go, and the capture ends saying why', async () => {
    holdForRecording.mockImplementationOnce(async (tabId: number, onEnded: (why: string) => void) => {
      const h: FakeHold = { tabId, sent: [], listeners: new Map(), released: false, ended: onEnded };
      holds.set(tabId, h);
      return {
        send: async (): Promise<{}> => {
          throw new Error('Network.enable refused');
        },
        on: (event: string, l: Listener) => h.listeners.set(event, [...(h.listeners.get(event) ?? []), l]),
        release: async () => void (h.released = true),
      };
    });
    await start();
    expect(holds.get(1)!.released).toBe(true);
    expect(out).toEqual([{ ended: 'Network.enable refused' }]);
  });

  it('a detach mid-recording ends it, what was caught kept', async () => {
    await start();
    emit(1, 'Network.requestWillBeSent', { requestId: 'r1', type: 'XHR', request: { method: 'GET', url: 'https://shop.example.test/a', headers: {} } });
    holds.get(1)!.ended('canceled_by_user');
    await flush();
    expect(calls()).toHaveLength(1);
    expect(out.at(-1)).toEqual({ ended: 'the debugger was detached (canceled_by_user)' });
  });

  it('stop releases every tab', async () => {
    const capture = await start('tabs');
    onActivated.emit({ tabId: 2, windowId: 9 });
    await flush();
    await flush();
    await capture.stop();
    expect(holds.get(1)!.released && holds.get(2)!.released).toBe(true);
  });
});

describe('tabs and mouse', () => {
  it("starts the page's steps, keeps a recorded tab's, and marks a tab change", async () => {
    await start('tabs-mouse');
    const started = pageCalls.find((c) => c.req.op === 'steps-start')!;
    const key = (started.req as unknown as { key: string }).key;
    onMessage.emit({ type: 'recording-step', key, step: { at: 5, kind: 'click', target: 'button "Pay"' } }, { tab: { id: 1 } }, () => undefined);
    onMessage.emit({ type: 'recording-step', key, step: { at: 6, kind: 'click', target: 'from a tab not recorded' } }, { tab: { id: 3 } }, () => undefined);
    onMessage.emit({ type: 'recording-step', key: 'another', step: { at: 7, kind: 'click', target: 'another key' } }, { tab: { id: 1 } }, () => undefined);
    onActivated.emit({ tabId: 2, windowId: 9 });
    await flush();
    await flush();
    const steps = out.filter((m) => 'step' in m).map((m) => m.step as Record<string, unknown>);
    expect(steps).toEqual([{ at: 5, kind: 'click', target: 'button "Pay"', tabId: 1 }, { at: expect.any(Number), tabId: 2, kind: 'tab', target: 'Pay (pay.example.test)' }]);
  });

  it('no steps in the other modes', async () => {
    await start('tabs');
    expect(pageCalls.some((c) => c.req.op === 'steps-start')).toBe(false);
  });
});

describe('fixes from the final review', () => {
  it('a stop while a tab is joining releases it', async () => {
    let resolveHold!: () => void;
    const pending = new Promise<void>((r) => (resolveHold = r));
    const capture = await start('tabs');
    holdForRecording.mockImplementationOnce(async (tabId: number, onEnded: (why: string) => void) => {
      await pending;
      const h: FakeHold = { tabId, sent: [], listeners: new Map(), released: false, ended: onEnded };
      holds.set(tabId, h);
      return { send: async () => ({}), on: () => h.listeners, release: async () => void (h.released = true) };
    });
    onActivated.emit({ tabId: 2, windowId: 9 });
    await flush();
    await capture.stop();
    resolveHold();
    await flush();
    await flush();
    expect(holds.get(2)!.released).toBe(true);
  });

  it('a held tab that moves to a site without access is let go', async () => {
    await start('tab');
    tabs[1] = { ...tabs[1]!, url: 'https://other.test/' };
    onUpdated.emit(1, { url: 'https://other.test/' }, { id: 1, windowId: 9, url: 'https://other.test/' });
    await flush();
    await flush();
    expect(holds.get(1)!.released).toBe(true);
    expect(out).toContainEqual({ ended: 'no access to other.test' });
  });

  it('steps start again after a held tab loads a page', async () => {
    await start('tabs-mouse');
    const before = pageCalls.filter((c) => c.req.op === 'steps-start').length;
    onUpdated.emit(1, { status: 'complete' } as never, { id: 1, windowId: 9, url: 'https://shop.example.test/next' });
    await flush();
    expect(pageCalls.filter((c) => c.req.op === 'steps-start').length).toBe(before + 1);
  });

  it('hides a secret in a body longer than the limit before cutting it', async () => {
    await start();
    emit(1, 'Network.requestWillBeSent', { requestId: 'big', type: 'Fetch', request: { method: 'GET', url: 'https://shop.example.test/me', headers: {} } });
    bodies.big = { body: JSON.stringify({ access_token: 'tok-secret-123', profile: 'x'.repeat(30_000) }), base64Encoded: false };
    emit(1, 'Network.loadingFinished', { requestId: 'big' });
    await flush();
    expect(String(updates().find((u) => u.responseBody)!.responseBody)).not.toContain('tok-secret-123');
  });

  it('a step during start does not throw', async () => {
    const run = start('tabs-mouse');
    onMessage.emit({ type: 'recording-step', key: 'x', step: { at: 1, kind: 'click' } }, { tab: { id: 1 } }, () => undefined);
    await expect(run).resolves.toBeDefined();
  });
});

describe('pending items, recording', () => {
  it('a redirect becomes a call of its own, the first one keeping its status', async () => {
    await start();
    emit(1, 'Network.requestWillBeSent', { requestId: 'r1', type: 'Document', request: { method: 'GET', url: 'https://shop.example.test/old', headers: {} } });
    emit(1, 'Network.requestWillBeSent', { requestId: 'r1', type: 'Document', request: { method: 'GET', url: 'https://shop.example.test/new', headers: {} }, redirectResponse: { status: 301 } });
    const ids = calls().map((c) => c.id);
    expect(new Set(ids).size).toBe(2);
    expect(calls().map((c) => c.url)).toEqual(['https://shop.example.test/old', 'https://shop.example.test/new']);
    expect(updates()).toContainEqual({ id: ids[0], status: 301 });
  });
});

describe('a preset', () => {
  const request = (id: string, type: string, url: string) => emit(1, 'Network.requestWillBeSent', { requestId: id, type, request: { method: 'GET', url, headers: {} } });
  it('leaves out what it does not keep, only counted', async () => {
    await start('tab', preset('api'));
    request('s', 'Script', 'https://shop.example.test/app.js');
    request('c', 'XHR', 'https://shop.example.test/collect');
    request('a', 'XHR', 'https://shop.example.test/api/items');
    expect(calls().map((c) => c.url)).toEqual(['https://shop.example.test/api/items']);
    expect(out.filter((m) => 'leftOut' in m).at(-1)).toEqual({ leftOut: 2 });
    expect(JSON.stringify(out)).not.toContain('app.js');
  });
  it('drops a kept call once its answer is not one it keeps', async () => {
    await start('tab', preset('errors'));
    request('ok', 'XHR', 'https://shop.example.test/api/ok');
    request('bad', 'XHR', 'https://shop.example.test/api/bad');
    emit(1, 'Network.responseReceived', { requestId: 'ok', response: { status: 200, mimeType: 'application/json' } });
    emit(1, 'Network.responseReceived', { requestId: 'bad', response: { status: 500, mimeType: 'application/json' } });
    expect(out).toContainEqual({ drop: '1::ok' });
    expect(out).not.toContainEqual({ drop: '1::bad' });
    expect(out.filter((m) => 'leftOut' in m).at(-1)).toEqual({ leftOut: 1 });
  });
  it('left-out calls do not count toward the 100', async () => {
    await start('tab', preset('api'));
    for (let i = 0; i < 150; i++) request(`n${i}`, 'XHR', `https://shop.example.test/collect?i=${i}`);
    for (let i = 0; i < 100; i++) request(`k${i}`, 'XHR', `https://shop.example.test/api/${i}`);
    await flush();
    expect(calls()).toHaveLength(100);
    expect(out.some((m) => 'ended' in m)).toBe(false);
  });
  it('cuts bodies at its size and stops at its time', async () => {
    vi.useFakeTimers();
    try {
      await start('tab', { ...preset('everything'), maxBody: 1000, maxMinutes: 2 });
      emit(1, 'Network.requestWillBeSent', { requestId: 'p', type: 'Fetch', request: { method: 'POST', url: 'https://shop.example.test/x', headers: {}, postData: JSON.stringify({ password: 'pw-secret', text: 'y'.repeat(5000) }) } });
      const body = String(calls()[0]!.requestBody);
      expect(body).toHaveLength(1000);
      expect(body).not.toContain('pw-secret');
      await vi.advanceTimersByTimeAsync(2 * 60_000);
      expect(out).toContainEqual({ ended: 'it reached 2 minutes' });
    } finally {
      vi.useRealTimers();
    }
  });
  it('a call dropped at its answer is not remembered: the same call failing later is kept', async () => {
    await start('tab', preset('errors'));
    request('a', 'XHR', 'https://shop.example.test/api/poll');
    emit(1, 'Network.responseReceived', { requestId: 'a', response: { status: 200, mimeType: 'application/json' } });
    request('b', 'XHR', 'https://shop.example.test/api/poll');
    expect(calls().map((c) => c.id)).toEqual(['1::a', '1::b']);
  });
});

describe('compressed and binary bodies', () => {
  const json = JSON.stringify({ name: 'Echidna', password: 'hunter2' });
  const b64 = (b: Uint8Array | Buffer) => Buffer.from(b).toString('base64');
  // As DevTools gives a body it cannot read as UTF-8: one character a byte.
  const latin1 = (b: Buffer) => b.toString('latin1');
  const post = (id: string, request: Record<string, unknown>) =>
    emit(1, 'Network.requestWillBeSent', { requestId: id, type: 'Fetch', request: { method: 'POST', url: `https://shop.example.test/api/${id}`, ...request } });
  const bodyOf = (id: string, key: 'requestBody' | 'responseBody') => {
    const call = calls().find((c) => c.id === `1::${id}`);
    return String(updates().filter((u) => u.id === `1::${id}` && u[key] !== undefined).at(-1)?.[key] ?? call?.[key]);
  };

  it("unpacks a gzip'd post from its bytes, by its Content-Encoding, and hides its password", async () => {
    await start();
    const packed = gzipSync(json);
    post('gz', { headers: { 'Content-Type': 'application/json', 'Content-Encoding': 'gzip' }, postData: latin1(packed), hasPostData: true, postDataEntries: [{ bytes: b64(packed) }] });
    await vi.waitFor(() => expect(bodyOf('gz', 'requestBody')).not.toBe('undefined'));
    expect(JSON.parse(bodyOf('gz', 'requestBody'))).toEqual({ name: 'Echidna', password: '••••' });
    expect(JSON.stringify(out)).not.toContain('hunter2');
    expect(JSON.stringify(out)).not.toContain('\\u001f');
  });

  it('a body asked for later comes in base64: unpacked too', async () => {
    await start();
    posted.later = { postData: b64(gzipSync(json)), base64Encoded: true };
    post('later', { headers: {}, hasPostData: true });
    await vi.waitFor(() => expect(bodyOf('later', 'requestBody')).not.toBe('undefined'));
    expect(bodyOf('later', 'requestBody')).toContain('"password":"••••"');
  });

  it('a binary post is (binary, N bytes), never garbled text', async () => {
    await start();
    const proto = Buffer.from([0x08, 0x96, 0x01, 0x12, 0x04, 0x6c, 0x61, 0x6d, 0x70]);
    post('bin', { headers: { 'Content-Type': 'application/x-protobuf' }, postData: latin1(proto), hasPostData: true, postDataEntries: [{ bytes: b64(proto) }] });
    await flush();
    expect(bodyOf('bin', 'requestBody')).toBe('(binary, 9 bytes)');
  });

  it('a garbled post without its bytes is binary too', async () => {
    await start();
    post('old', { headers: {}, postData: latin1(gzipSync(json)), hasPostData: true });
    await flush();
    expect(bodyOf('old', 'requestBody')).toMatch(/^\(binary, \d+ bytes\)$/);
  });

  it('an answer in base64: unpacked when packed, else binary', async () => {
    await start();
    post('a1', { headers: {} });
    post('a2', { headers: {} });
    emit(1, 'Network.responseReceived', { requestId: 'a1', response: { status: 200, mimeType: 'application/json' } });
    emit(1, 'Network.responseReceived', { requestId: 'a2', response: { status: 200, mimeType: 'image/png' } });
    bodies.a1 = { body: b64(gzipSync(JSON.stringify({ ok: true, token: 'tok-1' }))), base64Encoded: true };
    bodies.a2 = { body: b64(Buffer.from('fake png bytes')), base64Encoded: true };
    emit(1, 'Network.loadingFinished', { requestId: 'a1' });
    emit(1, 'Network.loadingFinished', { requestId: 'a2' });
    await vi.waitFor(() => expect(bodyOf('a1', 'responseBody')).not.toBe('undefined'));
    expect(JSON.parse(bodyOf('a1', 'responseBody'))).toEqual({ ok: true, token: '••••' });
    expect(bodyOf('a2', 'responseBody')).toBe('(binary, 14 bytes)');
  });
});
