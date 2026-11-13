import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { cutAt, findLoop, fragmentShown } = await import('../src/core/repetition');
const { loopCut, runAgentLoop } = await import('../src/core/agent-loop');
const { modelView } = await import('../src/context/compaction');
const { text } = await import('../src/core/model-texts');
const { ToolRegistry } = await import('../src/core/tool-registry');
const { collect, loop } = await import('./helpers');
type Message = import('../src/core/types').Message;
type ChatEvent = import('../src/core/types').ChatEvent;

// A model caught in a loop is cut as it streams, and told on the next message.
const prose = 'The page lists three products. The first is a cable, the second a charger, and the third a case for the phone. ';

describe('a loop', () => {
  it('of a short fragment, 50 times in a row over 400 characters', () => {
    const looped = `Reading txt_srch=Y1^1${'^*'.repeat(250)}`;
    const loop = findLoop(looped)!;
    expect(loop.fragment).toBe('^*');
    expect(cutAt(looped, loop)).toBe(`Reading txt_srch=Y1^1${'^*'.repeat(3)}`);
    expect(findLoop(`x${'^*'.repeat(150)}`)).toBeUndefined(); // 300 characters: not yet
  });

  it('of a sentence, 8 times in a row', () => {
    const again = 'I will now check the page again. ';
    const loop = findLoop(`${prose}${again.repeat(9)}`)!;
    expect(loop.fragment.length).toBe(again.length);
    expect(findLoop(`${prose}${again.repeat(6)}`)).toBeUndefined();
  });

  it('not in what only looks repetitive', () => {
    const table = `| Name | Price |\n|---|---|\n${Array.from({ length: 60 }, (_, i) => `| Item ${i} | ${i * 3} |\n`).join('')}`;
    const code = Array.from({ length: 80 }, (_, i) => `  const v${i} = read(${i});\n`).join('');
    for (const s of [prose.repeat(3), table, `${'='.repeat(80)}\nTitle\n${'='.repeat(80)}`, code, ' '.repeat(2000), '\n'.repeat(900), btoa(String.fromCharCode(...Array.from({ length: 1500 }, (_, i) => (i * 7919) % 256)))]) {
      expect(findLoop(s)).toBeUndefined();
    }
  });

  it('is shown in at most 40 characters, line breaks as \\n', () => {
    expect(fragmentShown('a\nb')).toBe('a\\nb');
    expect(fragmentShown('x'.repeat(50))).toBe(`${'x'.repeat(40)}…`);
  });
});

describe('the agent loop, when the model loops', () => {
  const ask: Message = { role: 'user', parts: [{ type: 'text', text: 'look it up' }] };
  const stream = (deltas: ChatEvent[]) => {
    let pulled = 0;
    let aborted = false;
    const provider = {
      listModels: async () => [],
      async *chat(_req: unknown, signal: AbortSignal) {
        signal.addEventListener('abort', () => (aborted = true));
        for (const d of deltas) {
          pulled++;
          yield d;
        }
      },
    };
    return { provider, pulled: () => pulled, aborted: () => aborted };
  };

  it('cuts the call, keeps what came before with a few repetitions, says so and ends the turn', async () => {
    const deltas: ChatEvent[] = [{ type: 'reasoning-delta', text: 'Thinking: txt_srch=' }, ...Array.from({ length: 400 }, (): ChatEvent => ({ type: 'reasoning-delta', text: '^*' })), { type: 'tool-call', id: 'c1', name: 'browser__find', args: {} }, { type: 'done', stopReason: 'length' }];
    const s = stream(deltas);
    const events = await collect(runAgentLoop([ask], loop(s.provider, new ToolRegistry()), new AbortController().signal));
    expect(s.pulled()).toBeLessThan(400); // not to the end
    expect(s.aborted()).toBe(true);
    const message = events.flatMap((e) => (e.type === 'message' ? [e.message] : []))[0]!;
    expect(message.cut).toBe('^*');
    expect(message.parts).toEqual([{ type: 'reasoning', text: `Thinking: txt_srch=${'^*'.repeat(3)}` }]);
    expect(events.filter((e) => e.type === 'notice')).toEqual([{ type: 'notice', text: loopCut('^*') }]);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('drops a call begun before the loop, in the text too, and an error the cut stream throws is not the turn\'s', async () => {
    const provider = {
      listModels: async () => [],
      // A stream that throws as it is closed early (a reader cancelled mid-read).
      async *chat() {
        try {
          yield { type: 'tool-call', id: 'c1', name: 'browser__find', args: {} } as ChatEvent;
          for (let i = 0; i < 400; i++) yield { type: 'text-delta', text: 'ab' } as ChatEvent;
        } finally {
          // eslint-disable-next-line no-unsafe-finally -- what such a stream does
          throw new DOMException('The operation was aborted.', 'AbortError');
        }
      },
    };
    const events = await collect(runAgentLoop([ask], loop(provider, new ToolRegistry()), new AbortController().signal));
    const message = events.flatMap((e) => (e.type === 'message' ? [e.message] : []))[0]!;
    expect(message.parts.map((p) => p.type)).toEqual(['text']); // the call it began goes without it
    expect(message.cut).toBe('ab');
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(events.at(-1)).toEqual({ type: 'done' });
  });

  it('tells the model on the next message', () => {
    const cut: Message = { role: 'assistant', parts: [{ type: 'text', text: 'x' }], cut: '^*' };
    const sent = modelView(undefined, [ask, cut, { role: 'user', parts: [{ type: 'text', text: 'again' }] }]).messages;
    expect(sent[2]!.parts[0]).toEqual({ type: 'text', text: `${text('user.repetition_cut', { fragment: '^*' })}\n` });
  });
});
