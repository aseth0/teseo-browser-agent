// The check before each request of a turn, on a model whose window the server does not publish: the
// window is Settings → Compaction's default (72k), the request carries 41 tools, and the conversation
// takes ~34k tokens as the server counts them. And Compact now when there is little or nothing to compact.
import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { runAgentLoop } = await import('../src/core/agent-loop');
const { ToolRegistry } = await import('../src/core/tool-registry');
const { runView } = await import('../src/background/run-setup');
const { estimatedInput, estimateRequest } = await import('../src/context/usage');
const { COMPACTION_DEFAULTS, compactionOf, compactionStep, fixedNote, nothingToCompactNote } = await import('../src/context/compaction');
const { collect, loop } = await import('./helpers');
type Message = import('../src/core/types').Message;
type ChatEvent = import('../src/core/types').ChatEvent;
type LoopContext = import('../src/core/agent-loop').LoopContext;
type LoopModel = import('../src/core/agent-loop').LoopModel;

const WINDOW = COMPACTION_DEFAULTS.defaultWindow;
const ask = (t: string): Message => ({ role: 'user', parts: [{ type: 'text', text: t }] });
const reply = (t: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text: t }] });

// 41 MCP tools, each with a schema of a few hundred tokens: ~14k tokens of definitions.
const tools = new ToolRegistry();
for (let i = 0; i < 41; i++) {
  const properties = Object.fromEntries(Array.from({ length: 12 }, (_, j) => [`field_${j}`, { type: 'string', description: `What field ${j} of tool ${i} takes, in a few words.` }]));
  tools.register({ name: `mcp.server_${i % 5}.tool_${i}`, description: `Tool ${i} of an MCP server: does one thing on it.`, inputSchema: { type: 'object', properties }, source: 'mcp', effect: 'write', run: async () => ({ type: 'text', text: `created item ${i}` }) });
}
tools.register({ name: 'browser.get_page_text', description: 'read', inputSchema: {}, source: 'browser', effect: 'read', run: async () => ({ type: 'text', text: 'r'.repeat(4000) }) });

// Earlier turns: ~20k tokens of conversation as estimated.
const history: Message[] = [
  ask('first'), reply('a'.repeat(40_000)),
  ask('second'), reply('b'.repeat(40_000)),
  ask('make the item again'),
];
const estimated = estimatedInput(estimateRequest(undefined, tools.specs(), history));

function run(model: Partial<LoopModel>, reported?: number) {
  const squeezes: number[] = [];
  let calls = 0;
  const provider = {
    listModels: async () => [],
    async *chat(): AsyncIterable<ChatEvent> {
      const n = calls++;
      if (reported) yield { type: 'usage', inputTokens: reported + n * 1200, outputTokens: 12 };
      if (n < 3) {
        yield { type: 'tool-call', id: `c${n}`, name: 'browser__get_page_text', args: {} };
        yield { type: 'done', stopReason: 'tool_calls' };
      } else {
        yield { type: 'text-delta', text: 'Done' };
        yield { type: 'done', stopReason: 'stop' };
      }
    },
  };
  const real = runView({ providers: [], systemPrompt: '' }, tools);
  const view: LoopContext['view'] = (system, messages, seen) => {
    squeezes.push(seen.squeeze ?? 0);
    return real(system, messages, seen);
  };
  const events = collect(runAgentLoop(history, loop(provider, tools, {
    model: { contextWindow: WINDOW, ...model },
    context: { view, estimate: (r) => estimatedInput(estimateRequest(r.system, r.tools, r.messages)) },
  }), new AbortController().signal));
  return { events, squeezes };
}
const notices = (events: { type: string; text?: string }[]) => events.flatMap((e) => (e.type === 'notice' ? [e.text!] : []));

describe('the check before each request, on the default window', () => {
  it('is a scenario of ~34k tokens with 41 tools', () => {
    expect(estimated).toBeGreaterThan(30_000);
    expect(estimated).toBeLessThan(WINDOW * 0.9);
  });

  it('with an estimate corrected far over what the server counts, shortens only to 1, and says by how much and why', async () => {
    // ×2.5 (the most a ratio goes to) puts ~34k at ~85k, over 90 % of 72k.
    const r = run({ windowSource: 'default', tokenRatio: 2.5 });
    const events = await r.events;
    expect(Math.max(...r.squeezes)).toBe(1);
    const [told] = notices(events);
    expect(told).toMatch(/^Context nearly full \(\d+k of 72k, default window; tools \d+k\)/);
    expect(told).toContain("Set the model's window in the context meter");
  });

  it('on a window known otherwise, still goes to 2 as before', async () => {
    const r = run({ windowSource: 'server', tokenRatio: 2.5 });
    await r.events;
    expect(r.squeezes).toContain(2);
  });

  it('once the server reported the request, counts from that: ~34k reported fits, whatever the ratio', async () => {
    const r = run({ windowSource: 'default', tokenRatio: 2.5 }, 34_000);
    await r.events;
    // The first request has nothing reported yet (0, then 1: nothing of the turn to leave out); the
    // later ones count from what the server reported, ~34k and a little more each step.
    expect(r.squeezes).toEqual([0, 1, 0, 0, 0]);
  });

  it('with the ratio as the server reports it, nothing is shortened', async () => {
    const r = run({ windowSource: 'default', tokenRatio: 1 }, 34_000);
    const events = await r.events;
    expect(r.squeezes.every((s) => s === 0)).toBe(true);
    expect(notices(events)).toEqual([]);
  });
});

describe('Compact now with fewer than 4 turns', () => {
  const cfg = compactionOf({});
  const short: Message[] = [ask('one'), reply('ok'), ask('two'), reply('ok')];

  it('finds nothing to compact, with or without a window, when it would save nothing', () => {
    expect(compactionStep(short, cfg, { used: 30_000, canSummarize: false, auto: false })).toBeUndefined();
    expect(compactionStep(short, cfg, { used: 30_000, window: WINDOW, canSummarize: false, auto: false })).toBeUndefined();
  });

  it('says so, and what the system prompt and the tools take of the context', () => {
    const note = nothingToCompactNote(false, cfg.keepTurns, fixedNote({ system: 2_000, tools: 10_000 }, 30_000));
    expect(note).toBe('Nothing to compact: the latest 4 turns are kept whole. 40% of the context is the system prompt and the tools (system 2,000, tools 10k), which compaction cannot shorten: turn off MCP servers or tools, or set servers to their tools on demand (Settings → MCP servers).');
    expect(nothingToCompactNote(true, 4, fixedNote({ system: 1_000, tools: 1_000 }, 30_000))).toBe('Nothing to compact: no earlier turns, and the latest is short. 7% of the context is the system prompt and the tools (system 1,000, tools 1,000), which compaction cannot shorten.');
    expect(nothingToCompactNote(true, 4, fixedNote(undefined, 30_000))).toBe('Nothing to compact: no earlier turns, and the latest is short.');
  });
});
