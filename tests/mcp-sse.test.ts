// A server that speaks only SSE gets the same headers on its event stream as on its requests: the
// configured ones, and the SDK's own (the OAuth token, the protocol, what it accepts).
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getManifest: () => ({ version: '0' }) } } }));
vi.mock('../src/mcp/origin', () => ({ withoutOrigin: async () => undefined }));
const { connectMcp } = await import('../src/mcp/connect');

afterEach(() => vi.unstubAllGlobals());

describe('an SSE server', () => {
  it('gets the headers and the OAuth token on its event stream', async () => {
    const streamHeaders: Headers[] = [];
    vi.stubGlobal('fetch', vi.fn(async (_url: string | URL, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('', { status: 405 }); // not Streamable HTTP
      streamHeaders.push(new Headers(init?.headers));
      return new Response('gone', { status: 500 });
    }));
    const auth = { tokens: async () => ({ access_token: 'tok-1', token_type: 'Bearer' }) } as unknown as OAuthClientProvider;
    await expect(connectMcp('https://mcp.example.com/sse', { 'X-Team': 'blue' }, auth)).rejects.toThrow();
    expect(streamHeaders.length).toBeGreaterThan(0);
    const h = streamHeaders[0]!;
    expect([h.get('x-team'), h.get('authorization'), h.get('accept')]).toEqual(['blue', 'Bearer tok-1', 'text/event-stream']);
  });
});
