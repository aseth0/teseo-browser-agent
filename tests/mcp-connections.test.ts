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
let stored: Record<string, unknown> = {}; // the session's storage
vi.mock('wxt/browser', () => ({ browser: { storage: { session: { get: async (keys: string[]) => Object.fromEntries(keys.filter((k) => k in stored).map((k) => [k, stored[k]])), set: async (v: Record<string, unknown>) => void Object.assign(stored, v) } } } }));
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
    await new Promise((r) => setTimeout(r)); // it has read what the session remembers
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
    stored = {};
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

  it('is not tried again by the runs, its error said again at once; a new conversation tries again, and a reset', async () => {
    vi.useFakeTimers();
    refuse = true;
    connects = 0;
    const mcp = new McpManager();
    expect((await mcp.tools([server('a')], [])).errors).toEqual([{ server: 'a', error: 'connection refused' }]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await mcp.tools([server('a')], [])).errors).toEqual([{ server: 'a', error: 'connection refused' }]);
    expect(connects).toBe(1);
    await mcp.connect([server('a')], []);
    await vi.advanceTimersByTimeAsync(10);
    expect(connects).toBe(2);
    mcp.reset();
    await mcp.tools([server('a')], []);
    expect(connects).toBe(3);
  });

  it('holds only the first run: the next ones go at once, and its tools come back once a new conversation reaches it', async () => {
    vi.useFakeTimers();
    hang = true;
    connects = 0;
    let back = 0;
    const mcp = new McpManager(() => back++);
    const first = mcp.tools([server('a')], []);
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await first).errors).toEqual([{ server: 'a', error: 'it did not connect within 15 s' }]);
    let out: Awaited<ReturnType<InstanceType<typeof McpManager>['tools']>> | undefined;
    void mcp.tools([server('a')], []).then((o) => (out = o));
    await vi.advanceTimersByTimeAsync(10);
    expect(out!.errors).toHaveLength(1);
    expect(connects).toBe(1);
    // A new conversation makes the hung connection anew: once in, offered again and the panels told.
    hang = false;
    await mcp.connect([server('a')], []);
    await vi.advanceTimersByTimeAsync(10);
    expect(connects).toBe(2);
    expect(back).toBe(1);
    expect((await mcp.tools([server('a')], [])).tools).toHaveLength(1);
  });

  it('a chat message does not wait for a server never reached: connected as the conversation starts, offered once in', async () => {
    vi.useFakeTimers();
    hang = true;
    const mcp = new McpManager();
    await mcp.connect([server('a')], []);
    let out: Awaited<ReturnType<InstanceType<typeof McpManager>['tools']>> | undefined;
    void mcp.tools([server('a')], [], undefined, undefined, true).then((o) => (out = o));
    await vi.advanceTimersByTimeAsync(10);
    expect(out).toEqual({ tools: [], errors: [{ server: 'a', error: 'it is still connecting' }] });
    // Too long connecting: failed, without any run having waited.
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await mcp.tools([server('a')], [], undefined, undefined, true)).errors).toEqual([{ server: 'a', error: 'it did not connect within 15 s' }]);
  });

  it('a chat message waits for a server reached before in the session, when the worker started again', async () => {
    vi.useFakeTimers();
    await new McpManager().tools([server('a')], []);
    await vi.advanceTimersByTimeAsync(10); // reached, and remembered
    let fail = () => {};
    failing = new Promise((r) => (fail = r)); // the next connection takes a while
    let out: Awaited<ReturnType<InstanceType<typeof McpManager>['tools']>> | undefined;
    void new McpManager().tools([server('a')], [], undefined, undefined, true).then((o) => (out = o));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(out).toBeUndefined(); // waited for
    fail();
    await vi.advanceTimersByTimeAsync(10);
    expect(out!.errors).toEqual([{ server: 'a', error: 'unreachable' }]);
  });

  it('is not waited for by a worker started again in the same session: its failure is remembered', async () => {
    vi.useFakeTimers();
    refuse = true;
    await new McpManager().tools([server('a')], []);
    refuse = false;
    hang = true;
    let out: Awaited<ReturnType<InstanceType<typeof McpManager>['tools']>> | undefined;
    void new McpManager().tools([server('a')], []).then((o) => (out = o));
    await vi.advanceTimersByTimeAsync(10);
    expect(out!.errors).toEqual([{ server: 'a', error: 'connection refused' }]);
  });

  it('is waited for no longer once the run is stopped', async () => {
    hang = true;
    const stop = new AbortController();
    const out = new McpManager().tools([server('a')], [], undefined, stop.signal);
    stop.abort();
    expect(await out).toEqual({ tools: [], errors: [] });
  });
});
