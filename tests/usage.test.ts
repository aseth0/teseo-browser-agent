import { describe, expect, it, vi } from 'vitest';
import { contextUsed, estimateOutput, estimateRequest, estimateSources, measureCall } from '../src/context/usage';
import { toOpenAIMessages, toOpenAITools } from '../src/providers/wire';
import { messagesTokens } from '../src/context/budget';
import { markValue, setValueMarking } from '../src/core/model-texts';
import type { Message } from '../src/core/types';

describe('context usage', () => {
  const messages: Message[] = [
    { role: 'user', parts: [{ type: 'text', text: 'x'.repeat(40) }, { type: 'text', text: 'p'.repeat(400), context: 'page' }, { type: 'text', text: 's'.repeat(80), context: 'skill' }] },
    { role: 'assistant', parts: [{ type: 'reasoning', text: 'r'.repeat(4000) }, { type: 'tool_call', id: 'c', name: 'f', args: {} }] },
    { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c', content: 't'.repeat(80), images: [{ mediaType: 'image/jpeg', data: '' }] }] },
  ];

  it('splits the request into system, tools, conversation, page context and tool results', () => {
    const b = estimateRequest('s'.repeat(8), [{ name: 'f', description: '', inputSchema: {} }], messages);
    expect(b.system).toBe(2 + 4); // its text + its message's framing
    expect(b.tools).toBeGreaterThan(0);
    // user text + tool call 'f{}' + its reasoning (sent back within the turn), and the framing: 4 a
    // message, 8 a call's id
    expect(b.conversation).toBe(10 + 1 + 1000 + 4 + (4 + 8));
    expect(b.pageContext).toBe(100);
    expect(b.skills).toBe(20);
    expect(b.toolResults).toBe(20 + 1500 + (4 + 8) + 4); // text + one image; its message, and one more for the image
  });

  it('weighs the reasoning the wire sends back: of the answers since your last message only', () => {
    const later: Message[] = [...messages, { role: 'assistant', parts: [{ type: 'text', text: 'done' }] }, { role: 'user', parts: [{ type: 'text', text: 'next' }] }];
    const sent = toOpenAIMessages(undefined, messages).flatMap((m) => (m.reasoning ? [m.reasoning] : []));
    expect(sent.join('')).toBe('r'.repeat(4000));
    expect(toOpenAIMessages(undefined, later).some((m) => m.reasoning)).toBe(false);
    expect(estimateRequest(undefined, [], messages).conversation - estimateRequest(undefined, [], later).conversation).toBe(1000 - (1 + 4 + 1 + 4));
    expect(messagesTokens(messages) - messagesTokens(later)).toBe(1000 - 2);
    expect(estimateSources(undefined, [], messages).answers! - estimateSources(undefined, [], later).answers!).toBeCloseTo(1000 - 1 - 4);
  });

  it('weighs the tools as the wire sends them', () => {
    const specs = [
      { name: 'browser__find', description: 'Finds text on the page.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } } },
      { name: 'f', description: '', inputSchema: {} },
    ];
    expect(estimateRequest(undefined, specs, []).tools).toBe(Math.ceil(JSON.stringify(toOpenAITools(specs)).length / 4));
  });

  it('sizes a list of tool specs once for both estimates', () => {
    const specs = [{ name: 'f', description: 'd', inputSchema: {} }];
    const stringify = vi.spyOn(JSON, 'stringify');
    const tools = estimateRequest('', specs, []).tools;
    expect(estimateSources('', specs, []).tools).toBe(tools);
    expect(stringify.mock.calls.filter(([v]) => v === specs)).toHaveLength(1);
    stringify.mockRestore();
  });

  it('counts reasoning in the output estimate', () => {
    expect(estimateOutput(messages[1]!.parts)).toBe(1000 + 1);
  });

  describe('a call with reasoning', () => {
    // 10,000 tokens of reasoning, then a 100-token answer: only the answer is sent back.
    const answer = [{ type: 'reasoning' as const, text: 'r'.repeat(40000) }, { type: 'text' as const, text: 'a'.repeat(400) }];
    const request = { tools: [], messages: [{ role: 'user' as const, parts: [{ type: 'text' as const, text: 'q'.repeat(400) }] }] };

    it('counts only the answer in the context, as the server split it', () => {
      const { usage, tokens } = measureCall(request, answer, { input: 2000, output: 10100, reasoning: 10000 });
      expect(contextUsed(usage)).toBe(2000 + 100);
      expect(tokens).toEqual({ input: 2000, output: 10100, reasoning: 10000 }); // as paid for, kept on its message
    });

    it('estimates the answer without the reasoning when the server does not split it', () => {
      expect(contextUsed(measureCall(request, answer, { input: 2000, output: 10150 }).usage)).toBe(2000 + 100);
    });

    it('estimates both when the server reports nothing', () => {
      const { usage, tokens } = measureCall(request, answer);
      expect(contextUsed(usage)).toBe(100 + 4 + 100); // the request (its text and framing) + the answer
      expect(tokens.output).toBe(10000 + 100);
    });

    it('takes the reported output whole when there was no reasoning', () => {
      expect(contextUsed(measureCall(request, [answer[1]!], { input: 2000, output: 120 }).usage)).toBe(2120);
    });
  });

  it('prefers the reported numbers over the estimate', () => {
    const breakdown = { system: 1, tools: 1, conversation: 1, pageContext: 1, skills: 0, toolResults: 1 };
    expect(contextUsed({ breakdown, estimatedOutput: 5 })).toBe(10);
    expect(contextUsed({ breakdown, estimatedOutput: 5, reported: { input: 2000, output: 48 } })).toBe(2048);
  });

  it('splits the request by origin: the marks in the text, else where the text is', () => {
    setValueMarking(true);
    try {
      const user: Message = {
        role: 'user',
        parts: [
          { type: 'text', text: 'm'.repeat(40) }, // what you typed
          { type: 'text', text: `${'w'.repeat(20)}${markValue('p'.repeat(400), 'page')}`, context: 'page' },
        ],
      };
      const result: Message = { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c', content: `ok ${markValue('t'.repeat(77), 'tool')}` }] };
      const s = estimateSources(`${'s'.repeat(8)}${markValue('k'.repeat(80), 'skill')}`, [], [user, messages[1]!, result]);
      // With the framing of each message (4) and of a call's id (8), as estimateRequest; the answer's
      // reasoning goes back with it (1000).
      expect(s).toEqual({ system: 2 + 4, skill: 20, message: 10 + 4, wrappers: 5, page: 100, answers: 1 + 1000 + 12, results: 1 + 12, tool: 20 });
    } finally {
      setValueMarking(false);
    }
  });
});
