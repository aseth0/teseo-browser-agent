import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import { OpenAICompatProvider } from '../src/providers/openai-compat';
import { collect } from './helpers';
import { mockFetch } from './fakes/browser';

const history: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'hi' }] }];
const d = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
const enc = new TextEncoder();

// A stream that sends `first` and then nothing, never ending: a server that stalled.
function stalled(...first: string[]): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      for (const s of first) c.enqueue(enc.encode(s));
    },
  });
  return new Response(stream, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}
const never = () => new Promise<Response>(() => {});

const p = () => new OpenAICompatProvider({ baseURL: 'https://gw.test/v1' });
// The error the chat ends with, or 'pending' while it has not ended.
function outcome(it: AsyncIterable<unknown>) {
  let result: unknown = 'pending';
  collect(it).then(
    () => (result = 'done'),
    (e: Error) => (result = e),
  );
  return () => result;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('a model request that hears nothing', () => {
  it('is given up when no answer arrives in time, not before', async () => {
    mockFetch(never);
    const result = outcome(p().chat({ model: 'm', messages: history }, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(119_000);
    expect(result()).toBe('pending');
    await vi.advanceTimersByTimeAsync(2_000);
    expect((result() as Error).message).toMatch(/no answer from the model in 120 s/);
  });

  it('is given up when its stream stops for too long between chunks', async () => {
    mockFetch(stalled(d({ choices: [{ delta: { content: 'He' } }] })));
    const result = outcome(p().chat({ model: 'm', messages: history }, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(59_000);
    expect(result()).toBe('pending');
    await vi.advanceTimersByTimeAsync(2_000);
    expect((result() as Error).message).toMatch(/nothing for 60 s/);
  });

  it('is aborted at once by Stop', async () => {
    mockFetch(never);
    const stop = new AbortController();
    const result = outcome(p().chat({ model: 'm', messages: history }, stop.signal));
    await vi.advanceTimersByTimeAsync(10);
    stop.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect((result() as Error).name).toBe('AbortError');
  });

  it('keeps no timer once the answer is complete', async () => {
    mockFetch(stalled(d({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }), 'data: [DONE]\n\n'));
    const result = outcome(p().chat({ model: 'm', messages: history }, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(0);
    expect(result()).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe('a busy or failing server', () => {
  const ok = () => new Response(d({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  const status = (s: number, headers: Record<string, string> = {}) => new Response('busy', { status: s, headers });

  it('is asked again after a 429, as Retry-After says, with one notice', async () => {
    const fetchMock = mockFetch([status(429, { 'Retry-After': '3' }), ok()]);
    const events: unknown[] = [];
    const done = collect(p().chat({ model: 'm', messages: history }, new AbortController().signal)).then((e) => events.push(...e));
    await vi.advanceTimersByTimeAsync(2_900);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    await done;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(events).toEqual([{ type: 'notice', text: 'm: the server answered 429, asked again.' }, { type: 'text-delta', text: 'ok' }, { type: 'done', stopReason: 'stop' }]);
  });

  it('is asked at most twice more after a 5xx, then the error ends the turn', async () => {
    const fetchMock = mockFetch([status(503), status(502), status(500), ok()]);
    const result = outcome(p().chat({ model: 'm', messages: history }, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect((result() as Error).message).toBe('chat 500: busy');
  });

  it('caps a long Retry-After', async () => {
    const fetchMock = mockFetch([status(429, { 'Retry-After': '3600' }), ok()]);
    const result = outcome(p().chat({ model: 'm', messages: history }, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(31_000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result()).toBe('done');
  });

  it('is not asked again after another 4xx', async () => {
    const fetchMock = mockFetch([status(401), ok()]);
    const result = outcome(p().chat({ model: 'm', messages: history }, new AbortController().signal));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((result() as Error).message).toBe('chat 401: busy');
  });

  it('stops waiting at once on Stop', async () => {
    const fetchMock = mockFetch([status(429, { 'Retry-After': '20' }), ok()]);
    const stop = new AbortController();
    const result = outcome(p().chat({ model: 'm', messages: history }, stop.signal));
    await vi.advanceTimersByTimeAsync(10);
    stop.abort();
    await vi.advanceTimersByTimeAsync(0);
    expect((result() as Error).name).toBe('AbortError');
    expect(vi.getTimerCount()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
