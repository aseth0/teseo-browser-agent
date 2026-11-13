// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { hookAnswers, relayAnswers, unhookAnswers } from '../src/recording/page-hooks';

// The page's hooks tell each fetch answer whole, up to the limit they are given, so that the extension
// can hide its secrets before cutting it: a JSON cut first could no longer be read to hide them. An
// answer is told as its head (method, URL, status, type) as JSON, then a line break, then its body as
// it is: the background reads the head alone until it knows the call.
const parse = (detail: string) => {
  const nl = detail.indexOf('\n');
  return { ...JSON.parse(nl < 0 ? detail : detail.slice(0, nl)), ...(nl >= 0 && { body: detail.slice(nl + 1) }) } as { method: string; url: string; status: number; body?: string; cut?: boolean };
};
const told = (key: string) => new Promise<{ method: string; url: string; status: number; body?: string; cut?: boolean }>((resolve) => document.addEventListener(key, (e) => resolve(parse((e as CustomEvent<string>).detail)), { once: true }));
const answering = (body: string) => {
  (window as unknown as { fetch: typeof fetch }).fetch = async () => new Response(body, { headers: { 'content-type': 'application/json' } });
};

describe('hookAnswers', () => {
  it('tells an answer longer than a body is kept, whole', async () => {
    const body = JSON.stringify({ access_token: 'tok-secret-123', profile: 'x'.repeat(30_000) });
    answering(body);
    hookAnswers('k1', 1_000_000);
    const answer = told('k1');
    await window.fetch('https://shop.example.test/api/me');
    expect(await answer).toMatchObject({ method: 'GET', url: 'https://shop.example.test/api/me', status: 200, body });
    expect((await answer).cut).toBeUndefined();
  });
  it('leaves nothing of itself among the window\'s properties', () => {
    hookAnswers('k3', 1000);
    expect(Object.keys(window)).not.toContain('k3');
    expect((window as unknown as Record<string, unknown>).k3).toBeUndefined();
  });
  it('past its limit, cuts it and says so', async () => {
    answering(JSON.stringify({ pad: 'y'.repeat(5000) }));
    hookAnswers('k2', 1000);
    const answer = told('k2');
    await window.fetch('https://shop.example.test/api/big');
    expect((await answer).body).toHaveLength(1000);
    expect((await answer).cut).toBe(true);
  });
});

// Once the recording ends, the page's fetch and XHR are its own again: nothing is read twice.
describe('unhookAnswers', () => {
  const page = window as unknown as { fetch: typeof fetch };
  it("gives the page back its own fetch and XHR methods", () => {
    answering('{}');
    const ownFetch = page.fetch;
    const { open, send } = XMLHttpRequest.prototype;
    hookAnswers('u1', 1000);
    expect(page.fetch).not.toBe(ownFetch);
    unhookAnswers('u1');
    expect(page.fetch).toBe(ownFetch);
    expect(XMLHttpRequest.prototype.open).toBe(open);
    expect(XMLHttpRequest.prototype.send).toBe(send);
  });
  it('leaves a wrapper the page put over its hooks, and they read nothing more', async () => {
    answering('{"a":1}');
    hookAnswers('u2', 1000);
    const hooked = page.fetch;
    const pageWrapper = (input: RequestInfo | URL, init?: RequestInit) => hooked(input, init);
    page.fetch = pageWrapper;
    unhookAnswers('u2');
    expect(page.fetch).toBe(pageWrapper);
    const clone = vi.spyOn(Response.prototype, 'clone');
    const heard = vi.fn();
    document.addEventListener('u2', heard);
    try {
      expect(await (await page.fetch('https://shop.example.test/api/x')).text()).toBe('{"a":1}');
      expect(clone).not.toHaveBeenCalled();
      expect(heard).not.toHaveBeenCalled();
    } finally {
      clone.mockRestore();
    }
  });
});

describe('an event stream', () => {
  it('is told by its head, never cloned: its body would be kept without end', async () => {
    (window as unknown as { fetch: typeof fetch }).fetch = async () => new Response('data: 1\n\n', { headers: { 'content-type': 'text/event-stream' } });
    hookAnswers('s1', 1000);
    const clone = vi.spyOn(Response.prototype, 'clone');
    try {
      const answer = told('s1');
      await window.fetch('https://shop.example.test/api/stream');
      expect(await answer).toMatchObject({ url: 'https://shop.example.test/api/stream', status: 200 });
      expect((await answer).body).toBeUndefined();
      expect(clone).not.toHaveBeenCalled();
    } finally {
      clone.mockRestore();
      unhookAnswers('s1');
    }
  });
});

describe('relayAnswers', () => {
  const sendMessage = vi.fn(async () => undefined);
  (globalThis as unknown as { chrome: unknown }).chrome = { runtime: { sendMessage } };
  it('forwards an answer up to the cap, drops a longer one, and is not a window property', () => {
    relayAnswers('r1', 100);
    expect(Object.keys(window)).not.toContain('r1');
    document.dispatchEvent(new CustomEvent('r1', { detail: 'x'.repeat(100) }));
    document.dispatchEvent(new CustomEvent('r1', { detail: 'y'.repeat(101) }));
    document.dispatchEvent(new CustomEvent('r1', { detail: { not: 'a string' } }));
    expect(sendMessage.mock.calls.map((c) => (c as unknown[])[0])).toEqual([{ type: 'recording-answer', key: 'r1', answer: 'x'.repeat(100) }]);
  });
});

// The hooks are injected, so they carry their own copy of recording/filter's `textual`: it decides
// whether an answer's body is told (text the model can read) or only its head. Both must agree.
describe("the hooks' textual types", () => {
  it('are those of recording/filter', async () => {
    const { textual } = await import('../src/recording/filter');
    const types = ['', 'application/json', 'text/html; charset=utf-8', 'application/xml', 'text/javascript', 'application/x-www-form-urlencoded', 'application/graphql-response+json', 'image/png', 'application/octet-stream', 'audio/webm', 'application/pdf', 'font/woff2', 'multipart/form-data'];
    let type = '';
    (window as unknown as { fetch: typeof fetch }).fetch = async () => new Response('body', { headers: type ? { 'content-type': type } : {} });
    hookAnswers('k-types', 1000);
    const seen: boolean[] = [];
    for (type of types) {
      const answer = told('k-types');
      await window.fetch('https://shop.example.test/api/x');
      seen.push((await answer).body !== undefined);
    }
    expect(seen).toEqual(types.map(textual));
    expect(seen).toContain(true);
    expect(seen).toContain(false);
  });
});
