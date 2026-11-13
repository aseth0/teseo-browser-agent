import { describe, expect, it } from 'vitest';
import type { LoopOptions } from '../src/core/agent-loop';
import { text } from '../src/core/model-texts';
import { execute } from '../src/core/tool-exec';
import { ToolRegistry, toWireName } from '../src/core/tool-registry';
import type { Tool, ToolContext } from '../src/core/types';

const shot = (note?: string): Tool => ({
  name: 'browser.screenshot',
  description: '',
  inputSchema: { type: 'object' },
  source: 'browser',
  effect: 'read',
  run: async () => ({ type: 'image', mediaType: 'image/jpeg', data: 'AAAA', note }),
});

const run = async (tool: Tool) => {
  const tools = new ToolRegistry();
  tools.register(tool);
  const ctx = { signal: new AbortController().signal, settings: {}, conversationId: 'c1', callId: 'k1' } as unknown as ToolContext;
  return execute({ tools: { registry: tools } } as unknown as LoopOptions, tools, toWireName(tool.name), {}, ctx);
};

describe('an image tool result', () => {
  it('says its note after the screenshot text', async () => {
    const r = await run(shot('2 sensitive fields were masked'));
    expect(r.content).toBe(`${text('result.screenshot')} 2 sensitive fields were masked`);
    expect(r.images).toEqual([{ mediaType: 'image/jpeg', data: 'AAAA' }]);
  });

  it('is the screenshot text alone without one', async () => expect((await run(shot())).content).toBe(text('result.screenshot')));
});

describe('a call through DevTools', () => {
  it('its result says so, for the chat', async () => {
    const tool: Tool = { name: 'browser.hover', description: '', inputSchema: { type: 'object' }, source: 'browser', effect: 'read', via: 'devtools', run: async () => ({ type: 'text', text: 'hovered' }) };
    expect((await run(tool)).devtools).toBe(true);
    expect((await run({ ...tool, name: 'browser.find', via: undefined })).devtools).toBeUndefined();
  });
});
