// An agent asked by another (agents.ask): on its own model or its caller's, its answer back to the
// caller with notes for a step limit or a reply cut, and a failure with the whole run as its trace.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noPhases } from '../src/core/phases';
import type { ChatEvent, LLMProvider } from '../src/core/types';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
// The user's tab 5 is on a shop page; 6 on a browser page.
const userTabs: Record<number, string> = { 5: 'https://shop.example.com/item', 6: 'chrome://settings/' };
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage, { tabs: { get: async (id: number) => ({ id, url: userTabs[id] }) } }) }));
const loaded: number[] = [];
vi.mock('../src/page/bridge', async (original) => ({ ...(await original<typeof import('../src/page/bridge')>()), waitForLoad: async (id: number) => void loaded.push(id) }));
let reachable = true;
vi.mock('../src/providers/provider-access', () => ({ reachOrAsk: async () => reachable }));
// The provider each run gets, by the model it runs on.
const used: string[] = [];
const offered: string[][] = []; // the tools each request offered
let script: ChatEvent[] | Error = [];
const queued: ChatEvent[][] = []; // replies before `script`, one per request
vi.mock('../src/providers/registry', () => ({
  createProvider: (cfg: { id: string }): LLMProvider => ({
    listModels: async () => [],
    async *chat(req) {
      used.push(`${cfg.id}/${req.model}`);
      offered.push((req.tools ?? []).map((t) => t.name));
      if (script instanceof Error) throw script;
      yield* queued.shift() ?? script;
    },
  }),
}));
// Its own tab: opened in the window of the panel's tab, closed once it is done.
const tabs = { opened: [] as unknown[], closed: [] as number[] };
vi.mock('../src/page/background-tab', () => ({
  LOAD_TIMEOUT_MS: 0,
  createBackgroundTab: async (url: string, options: unknown) => {
    tabs.opened.push({ url, options });
    return 77;
  },
  closeBackgroundTab: async (id: number) => void tabs.closed.push(id),
}));
const { runSubAgent, toolsNote } = await import('../src/background/sub-agent');
const { ToolRegistry } = await import('../src/core/tool-registry');
const { newAgentProfile } = await import('../src/agents/profiles');
type RunScope = import('../src/background/run-setup').RunScope;
const { blacklistGate } = await import('../src/word-blacklist/gate');

const caller = { cfg: { id: 'main', name: 'Main', baseURL: 'https://llm.test/v1', apiKey: '', defaultModel: 'big' }, model: 'big' };
const own = { id: 'own', name: 'Own', baseURL: 'https://other.test/v1', apiKey: '', defaultModel: 'small' };
const settings: { providers: unknown[]; systemPrompt: string; dateTime?: object } = { providers: [caller.cfg, own], systemPrompt: '' };
// What the user is asked, and answers: no (as when nobody answers) unless a test says.
const asks: unknown[] = [];
let reply: (q: unknown) => boolean = () => false;
const questions = { ask: async (q: (id: string) => unknown) => { const asked = q('q1'); asks.push(asked); return reply(asked); } };
const run = (all = new ToolRegistry(), tabId = 5): RunScope => ({
  msg: { type: 'run', history: [], providerId: 'main', model: 'big', tabId },
  settings, all, agents: [], allSkills: [], allTemplates: [], allMemory: [], logMode: 'off', listedUrl: undefined,
  inConversation: undefined, askAccess: async () => true, runSubAgent: async () => ({ type: 'text', text: '' }), blacklist: blacklistGate(undefined), phases: noPhases,
  signal: new AbortController().signal, send: () => undefined, questions: questions as never, interact: async () => ({}) as never,
} as unknown as RunScope);
const asked = { ...newAgentProfile(), id: 'mm', name: 'mm' };
const ask = (agent = asked) => runSubAgent(run(), { asked: agent, caller: undefined, task: 'find it', callId: undefined, depth: 2, callerTarget: caller });
const answer = (s: string): ChatEvent[] => [{ type: 'text-delta', text: s }, { type: 'done', stopReason: 'stop' }];

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
  used.length = offered.length = queued.length = 0;
  tabs.opened.length = tabs.closed.length = loaded.length = 0;
  reachable = true;
  asks.length = 0;
  reply = () => false;
});

describe('an agent asked by another', () => {
  it("runs on its own model when it has one, else its caller's, and answers in the caller's block", async () => {
    script = answer('Found it');
    const r1 = await ask();
    expect(used).toEqual(['main/big']);
    expect(r1.type === 'text' && r1.text).toContain('Found it');
    await ask({ ...asked, providerId: 'own', model: 'small' });
    expect(used.at(-1)).toBe('own/small');
  });

  it('says after its answer, outside the untrusted block, how many tool calls it made and how many failed', async () => {
    script = answer('Found it');
    const r = await ask();
    expect(r.type === 'text' && r.text).toMatch(/<\/untrusted_agent_answer>\n\(It made no tool calls\.\)$/);
    const call = (id: string) => ({ type: 'tool_call' as const, id, name: 'x', args: {} });
    const result = (id: string, isError?: boolean) => ({ type: 'tool_result' as const, toolCallId: id, content: '', ...(isError && { isError }) });
    const said = (n: number, failed: number) => toolsNote([
      { role: 'assistant', parts: Array.from({ length: n }, (_, i) => call(`c${i}`)) },
      { role: 'tool', parts: Array.from({ length: n }, (_, i) => result(`c${i}`, i < failed)) },
    ]);
    expect(said(1, 0)).toBe('(It made 1 tool call; 0 failed.)');
    expect(said(3, 2)).toBe('(It made 3 tool calls; 2 failed.)');
  });

  it('gets its task with when it was asked at its end (Settings → About you → Date & time), not shown as the task', async () => {
    script = answer('Found it');
    const r = await ask();
    const task = r.type === 'text' ? r.trace?.messages[0] : undefined;
    const last = task?.parts.at(-1);
    expect(last).toMatchObject({ type: 'text', context: 'tool', source: 'message-time' });
    expect(last?.type === 'text' && last.text).toMatch(/^<message_time>\w+day, \d{1,2} \w+ \d{4}, \d{2}:\d{2} \(.+, UTC[+-]\d{2}:\d{2}\)<\/message_time>$/);
    // All off: the task alone.
    settings.dateTime = { weekday: false, date: false, time: false, zone: false };
    try {
      const off = await ask();
      expect(off.type === 'text' && off.trace?.messages[0]!.parts.map((p) => p.type === 'text' && p.source)).toEqual([undefined]);
    } finally {
      delete settings.dateTime;
    }
  });

  it('says it could not run without access to its provider', async () => {
    reachable = false;
    expect(await ask()).toMatchObject({ isError: true, text: expect.stringContaining('could not run') });
    expect(used).toEqual([]);
  });

  it('fails with what the server said, the run kept as its trace', async () => {
    script = new Error('chat 500: down');
    const r = await ask();
    expect(r).toMatchObject({ isError: true, text: expect.stringContaining('chat 500: down') });
    expect(r.type === 'text' && r.trace?.messages[0]!.role).toBe('user');
  });

  it('says it stopped at its step limit', async () => {
    script = [{ type: 'text-delta', text: 'Looking' }, { type: 'tool-call', id: 'x', name: 'nowhere__tool', args: {} }, { type: 'done', stopReason: 'tool_calls' }];
    const r = await ask();
    expect(r.type === 'text' && r.text).toContain('(It stopped at its step limit before finishing.)');
  });

  it('asks the user whether to go on at its step limit, by its name and steps; no: it answers as it is', async () => {
    script = [{ type: 'tool-call', id: 'x', name: 'nowhere__tool', args: {} }, { type: 'done', stopReason: 'tool_calls' }];
    await ask();
    expect(asks).toEqual([{ type: 'more-steps', id: 'q1', agent: 'mm', steps: expect.any(Number) }]);
  });

  it('goes on where it was when the user lets it, with as many steps again', async () => {
    script = [{ type: 'tool-call', id: 'x', name: 'nowhere__tool', args: {} }, { type: 'done', stopReason: 'tool_calls' }];
    reply = () => {
      script = answer('Finished');
      return true;
    };
    const r = await ask();
    const steps = (asks[0] as { steps: number }).steps;
    expect(used).toHaveLength(steps + 1);
    expect(r.type === 'text' && r.text).toContain('Finished');
    expect(r.type === 'text' && r.text).not.toContain('step limit');
    // The whole run in its trace: the task, then each step's answer and results, on from where it was.
    expect(r.type === 'text' && r.trace?.messages).toHaveLength(1 + 2 * steps + 1);
  });

  it("works with its browser tools in a background tab of its own, on the user's page loaded again, closed once done", async () => {
    const all = new ToolRegistry();
    const ranOn: (number | undefined)[] = [];
    const tool = (name: string, source: 'browser' | 'webmcp') =>
      all.register({ name, description: '', inputSchema: { type: 'object' }, source, effect: 'read', siteless: true, run: async (_a, ctx) => (ranOn.push(ctx.tabId), { type: 'text', text: 'ok' }) });
    tool('browser.get_page_text', 'browser');
    tool('webmcp.user_page_tool', 'webmcp'); // the user's page's own tool
    const agent = { ...asked, tools: ['browser.get_page_text', 'webmcp.user_page_tool'] };
    queued.push([{ type: 'tool-call', id: 'c1', name: 'browser__get_page_text', args: {} }, { type: 'done', stopReason: 'tool_calls' }]);
    script = answer('Read it');
    const r = await runSubAgent(run(all), { asked: agent, caller: undefined, task: 'read it', callId: undefined, depth: 2, callerTarget: caller });
    expect(r.type === 'text' && r.text).toContain('Read it');
    expect(tabs.opened).toEqual([{ url: 'https://shop.example.com/item', options: { web: undefined, agentTab: 5 } }]);
    expect(loaded).toEqual([77]);
    expect(ranOn).toEqual([77]);
    expect(offered[0]).toContain('browser__get_page_text');
    expect(offered[0]).not.toContain('webmcp__user_page_tool');
    expect(tabs.closed).toEqual([77]);
  });

  it('opens no tab without browser tools; starts blank where the user is not on a web page; closes its tab when it fails', async () => {
    script = answer('Done');
    await ask();
    expect(tabs.opened).toEqual([]);
    const all = new ToolRegistry();
    all.register({ name: 'browser.get_page_text', description: '', inputSchema: { type: 'object' }, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: '' }) });
    script = new Error('chat 500: down');
    await runSubAgent(run(all, 6), { asked: { ...asked, tools: ['browser.get_page_text'] }, caller: undefined, task: 't', callId: undefined, depth: 2, callerTarget: caller });
    expect(tabs.opened).toEqual([{ url: 'about:blank', options: { web: undefined, agentTab: 6 } }]); // not a web page: blank
    expect(tabs.closed).toEqual([77]);
  });

  it('says its reply was cut when it kept repeating itself', async () => {
    script = [{ type: 'text-delta', text: 'Sure: ' }, ...Array.from({ length: 300 }, (): ChatEvent => ({ type: 'text-delta', text: '^*' })), { type: 'done', stopReason: 'length' }];
    const r = await ask();
    expect(r.type === 'text' && r.text).toContain('(Its reply was cut: it kept repeating "^*".)');
  });
});
