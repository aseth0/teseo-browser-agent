// The MCP connections: a server no longer in the settings is closed, the others stay open; a call whose
// session expired connects again once, without closing a connection another call already made anew.
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '../src/mcp/config';
import { TOOL_SETTINGS } from './helpers';

let failNext = 0; // calls to fail as an expired session, on the first connection
const clients: { url: string; closed: boolean; n: number }[] = [];
let failing: Promise<void> | undefined; // the next connection fails once this settles
let refuse = false; // connections fail at once
let hang = false; // connections never settle
let connects = 0;
vi.mock('wxt/browser', () => ({ browser: { storage: { session: { get: async () => ({}), set: async () => undefined } } } }));
vi.mock('../src/mcp/logs', () => ({ logMcp: async () => undefined }));
vi.mock('../src/mcp/connect', () => ({
  connectMcp: async (url: string) => {
    connects++;
    if (hang) return new Promise(() => {});
    if (refuse) throw new Error('connection refused');
    const fails = failing;
    failing = undefined;
    if (fails) {
      await fails;
      throw new Error('unreachable');
    }
    const me = { url, closed: false, n: clients.length };
    clients.push(me);
    return {
      transport: 'streamable-http',
      client: {
        close: async () => void (me.closed = true),
        listTools: async () => ({ tools: [{ name: 'echo', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }] }),
        callTool: async () => {
          await new Promise((r) => setTimeout(r, 5));
          if (me.n === 0 && failNext-- > 0) throw Object.assign(new Error('Session not found'), { code: 404 });
          return { content: [{ type: 'text', text: `ok ${me.n}` }] };
        },
      },
    };
  },
}));
const { McpManager } = await import('../src/mcp/manager');
const server = (name: string): McpServerConfig => ({ id: name, name, url: `https://${name}.example.com/mcp`, enabled: true });
const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal };

describe('MCP connections', () => {
  it('stay open for the servers still in the settings', async () => {
    clients.length = 0;
    const mcp = new McpManager();
    await mcp.tools([server('a'), server('b')], []);
    mcp.keepOnly([server('a')], []);
    await new Promise((r) => setTimeout(r));
    expect(clients.map((c) => [c.url, c.closed])).toEqual([['https://a.example.com/mcp', false], ['https://b.example.com/mcp', true]]);
  });

  it('are made again for a server whose sign-in settings changed', async () => {
    clients.length = 0;
    const mcp = new McpManager();
    await mcp.tools([server('a')], []);
    mcp.keepOnly([{ ...server('a'), oauth: { clientId: 'new-client' } }], []);
    await new Promise((r) => setTimeout(r));
    expect(clients[0]!.closed).toBe(true);
  });

  it('connect again once for a call whose session expired, one new connection for two such calls', async () => {
    clients.length = 0;
    const mcp = new McpManager();
    const [tool] = (await mcp.tools([server('a')], [])).tools;
    failNext = 2;
    const results = await Promise.all([tool!.run({}, ctx), tool!.run({}, ctx)]);
    expect(results.every((r) => r.type === 'text' && r.text.includes('ok 1'))).toBe(true);
    expect(clients).toHaveLength(2);
  });

  it('a failed connection leaves alone the one made in its place after a reset', async () => {
    clients.length = 0;
    const mcp = new McpManager();
    let fail = () => {};
    failing = new Promise((r) => (fail = r));
    const first = mcp.tools([server('a')], []);
    mcp.reset();
    expect((await mcp.tools([server('a')], [])).tools).toHaveLength(1);
    fail();
    expect((await first).errors).toHaveLength(1);
    expect((await mcp.tools([server('a')], [])).tools).toHaveLength(1);
    expect(clients).toHaveLength(1); // the same one: not connected again
  });
});

describe('an MCP server that cannot be reached', () => {
  afterEach(() => {
    vi.useRealTimers();
    refuse = hang = false;
  });

  it('holds a run at most 15 s, then the run goes without its tools', async () => {
    vi.useFakeTimers();
    hang = true;
    let out: Awaited<ReturnType<InstanceType<typeof McpManager>['tools']>> | undefined;
    void new McpManager().tools([server('a')], []).then((o) => (out = o));
    await vi.advanceTimersByTimeAsync(14_000);
    expect(out).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(out!.tools).toEqual([]);
    expect(out!.errors).toEqual([{ server: 'a', error: 'it did not connect within 15 s' }]);
  });

  it('is not tried again for 30 s, its error said again meanwhile; a reset tries at once', async () => {
    vi.useFakeTimers();
    refuse = true;
    connects = 0;
    const mcp = new McpManager();
    expect((await mcp.tools([server('a')], [])).errors).toEqual([{ server: 'a', error: 'connection refused' }]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await mcp.tools([server('a')], [])).errors).toEqual([{ server: 'a', error: 'connection refused' }]);
    expect(connects).toBe(1);
    await vi.advanceTimersByTimeAsync(11_000);
    await mcp.tools([server('a')], []);
    expect(connects).toBe(2);
    mcp.reset();
    await mcp.tools([server('a')], []);
    expect(connects).toBe(3);
  });

  it('is waited for no longer once the run is stopped', async () => {
    hang = true;
    const stop = new AbortController();
    const out = new McpManager().tools([server('a')], [], undefined, stop.signal);
    stop.abort();
    expect(await out).toEqual({ tools: [], errors: [] });
  });
});
