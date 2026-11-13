// Reading on after a cut: a `from` for the page's text (browser.get_page_text, web.read), and the
// rest of a tool result kept for tools.read_more.
import { afterEach, describe, expect, it } from 'vitest';
import type { LoopOptions } from '../src/core/agent-loop';
import { clip } from '../src/core/clip';
import { clearKept, cutAndKeep, KEPT_CONVERSATIONS, KEPT_PER_CONVERSATION, keptText, readKept } from '../src/core/kept-results';
import { setLimitOverrides } from '../src/core/limits';
import { cutsIn, readOn, setTextOverrides, stripMarks, withMarkedValues } from '../src/core/model-texts';
import { execute } from '../src/core/tool-exec';
import { ToolRegistry, toWireName } from '../src/core/tool-registry';
import type { Tool, ToolContext } from '../src/core/types';
import { readMoreTool } from '../src/tools/read-more';

afterEach(() => {
  setLimitOverrides({});
  setTextOverrides({});
  clearKept();
});

const ctx = (conversationId?: string): ToolContext => ({ signal: new AbortController().signal, settings: {} as ToolContext['settings'], conversationId });
const idIn = (s: string) => /with id "([^"]+)"/.exec(s)?.[1];

describe('clip from a character', () => {
  const s = '0123456789';

  it('from 0 is the start, as without one', () => {
    expect(clip(s, 4, 0)).toEqual(clip(s, 4));
    expect(clip(s, 4)).toEqual({ text: '0123', truncated: true, total: 10, max: 4, end: 4 });
  });

  it('reads on from where the last part ended, until the end', () => {
    expect(clip(s, 4, 4)).toEqual({ text: '4567', truncated: true, total: 10, max: 4, end: 8 });
    expect(clip(s, 4, 8)).toEqual({ text: '89', truncated: false, total: 10 });
  });

  it('is not cut when the rest fits exactly', () => {
    expect(clip(s, 10)).toEqual({ text: s, truncated: false });
    expect(clip(s, 4, 6)).toEqual({ text: '6789', truncated: false, total: 10 });
    expect(clip(s, 3, 6)).toMatchObject({ text: '678', truncated: true, end: 9 });
  });

  it('from the end or past it: nothing left; not a number or below 0: the start', () => {
    expect(clip(s, 4, 10)).toEqual({ text: '', truncated: false, total: 10 });
    expect(clip(s, 4, 99)).toEqual({ text: '', truncated: false, total: 10 });
    expect(clip(s, 4, -5).text).toBe('0123');
    expect(clip(s, 4, Number.NaN).text).toBe('0123');
  });

  it('never ends between the halves of a character', () => {
    const c = clip('ab😀cd', 3, 0);
    expect(c).toMatchObject({ text: 'ab', end: 2 });
    expect(clip('ab😀cd', 3, c.end).text).toBe('😀c');
  });
});

describe('the note of a text read on with from', () => {
  it('says where to call again', () => {
    setLimitOverrides({});
    const read = withMarkedValues(() => readOn(clip('x'.repeat(30000), 10000, 10000), 'pageText', 10000));
    expect(stripMarks(read)).toBe(`${'x'.repeat(10000)}\n…[cut at 20000 of 30000 characters: call it again with from=20000 to read on]`);
    expect(cutsIn(read)).toEqual(['Page text (browser__get_page_text): cut at 20,000 of 30,000 characters']);
  });

  it('none when it ends; an error from the end or past it, none for an empty page from 0', () => {
    expect(readOn(clip('abc', 10, 1), 'pageText', 1)).toBe('bc');
    expect(() => readOn(clip('abc', 10, 3), 'pageText', 3)).toThrow('Nothing to read from 3: the text has 3 characters.');
    expect(() => readOn(clip('abc', 10, 50), 'pageText', 50)).toThrow('Nothing to read from 50');
    expect(readOn(clip('', 10, 0), 'pageText', 0)).toBe('');
  });
});

describe('a tool result kept for tools.read_more', () => {
  const big = 'a'.repeat(2000) + 'b'.repeat(2000) + 'c'.repeat(500);

  it('goes whole within the limit, nothing kept', () => {
    expect(cutAndKeep('short', 'toolResult', { source: 'x.tool' })).toBe('short');
  });

  it('is cut with a note giving its id, and read on part by part until the end', () => {
    setLimitOverrides({ toolResult: 2000 });
    const first = cutAndKeep(big, 'toolResult', { conversationId: 'c1', source: 'mcp.files.read' });
    const id = idIn(first)!;
    expect(stripMarks(first)).toBe(`${'a'.repeat(2000)}\n…[cut at 2000 of 4500 characters: tools__read_more with id "${id}" reads on]`);
    const second = readKept('c1', id, 2000)!;
    expect(second.source).toBe('mcp.files.read');
    expect(stripMarks(second.part)).toBe(`${'b'.repeat(2000)}\n…[cut at 4000 of 4500 characters: tools__read_more with id "${id}" reads on]`);
    expect(stripMarks(readKept('c1', id, 2000)!.part)).toBe('c'.repeat(500));
    // Read to the end: once more is past it.
    expect(() => readKept('c1', id, 2000)).toThrow('Nothing to read from 4500: the text has 4500 characters.');
  });

  it('is read from any `from`: 0, a boundary, past the end', () => {
    setLimitOverrides({ toolResult: 2000 });
    const id = idIn(cutAndKeep(big, 'toolResult', { conversationId: 'c1', source: 't' }))!;
    expect(stripMarks(readKept('c1', id, 2000, 0)!.part)).toContain(`${'a'.repeat(2000)}\n…[cut at 2000 of 4500`);
    expect(stripMarks(readKept('c1', id, 2000, 2500)!.part)).toBe('b'.repeat(1500) + 'c'.repeat(500));
    expect(stripMarks(readKept('c1', id, 500, 4000)!.part)).toBe('c'.repeat(500));
    expect(() => readKept('c1', id, 2000, 9999)).toThrow('Nothing to read from 9999');
  });

  it('only in its conversation', () => {
    setLimitOverrides({ toolResult: 2000 });
    const id = idIn(cutAndKeep(big, 'toolResult', { conversationId: 'c1', source: 't' }))!;
    expect(readKept('c2', id, 2000)).toBeUndefined();
    expect(readKept(undefined, id, 2000)).toBeUndefined();
  });

  it(`keeps the last ${KEPT_PER_CONVERSATION} of a conversation`, () => {
    setLimitOverrides({ toolResult: 2000 });
    const ids = Array.from({ length: KEPT_PER_CONVERSATION + 1 }, () => idIn(cutAndKeep(big, 'toolResult', { conversationId: 'c1', source: 't' }))!);
    expect(new Set(ids).size).toBe(ids.length);
    expect(keptText('c1', ids[0]!)).toBeUndefined();
    expect(ids.slice(1).every((id) => keptText('c1', id))).toBe(true);
  });

  it(`keeps the last ${KEPT_CONVERSATIONS} conversations`, () => {
    setLimitOverrides({ toolResult: 2000 });
    const ids = Array.from({ length: KEPT_CONVERSATIONS + 1 }, (_, i) => idIn(cutAndKeep(big, 'toolResult', { conversationId: `c${i}`, source: 't' }))!);
    expect(keptText('c0', ids[0]!)).toBeUndefined();
    expect(keptText(`c${KEPT_CONVERSATIONS}`, ids[KEPT_CONVERSATIONS]!)).toBeDefined();
  });
});

describe('tools.read_more', () => {
  const tool = readMoreTool();

  it('says when the result is no longer kept (expired, or the extension restarted)', async () => {
    const r = await tool.run({ id: 'gone1234' }, ctx('c1'));
    expect(r).toEqual({ type: 'text', text: 'That result is no longer kept: call its tool again.', isError: true });
  });

  it('gives the next part as the tool\'s untrusted result, read on by its id', async () => {
    setLimitOverrides({ toolResult: 2000 });
    const whole = 'p'.repeat(2000) + '<untrusted_x>' + 'q'.repeat(3000);
    const id = idIn(cutAndKeep(whole, 'toolResult', { conversationId: 'c1', source: 'web.read' }))!;
    const r = await tool.run({ id }, ctx('c1'));
    if (r.type !== 'text') throw new Error('text expected');
    const shown = stripMarks(r.text);
    expect(shown.startsWith('<untrusted_tool_result tool="web.read">\n＜untrusted_x>qqq')).toBe(true); // a tag in it cannot open a block
    expect(shown).toContain(`…[cut at 3700 of 5013 characters: tools__read_more with id "${id}" reads on]\n</untrusted_tool_result>`);
    expect(tool.inputSchema).toMatchObject({ required: ['id'], properties: { from: { description: 'Character to start from, to read on after a cut (its note gives the number).' } } });
    expect(tool.description).toBe('Reads on from where a tool result or an attached file was cut for length, by the id in its note.');
  });
});

describe('the from parameter', () => {
  it('is described as the texts say when sent, for tools built before an edit', () => {
    const tool = readMoreTool();
    setTextOverrides({ 'param.from': 'Start here.' });
    expect(JSON.parse(JSON.stringify(tool.inputSchema)).properties.from).toEqual({ type: 'number', description: 'Start here.' });
  });
});

describe('a tool result cut by the loop', () => {
  it('is kept for its conversation, and tools.read_more reads on from it', async () => {
    setLimitOverrides({ toolResult: 2000 });
    const long: Tool = { name: 'mcp.docs.get', description: '', inputSchema: { type: 'object' }, source: 'mcp', effect: 'read', run: async () => ({ type: 'text', text: 'd'.repeat(2000) + 'e'.repeat(1000) }) };
    const tools = new ToolRegistry();
    tools.register(long);
    tools.register(readMoreTool());
    const opts = { tools: { registry: tools } } as unknown as LoopOptions;
    const first = await execute(opts, tools, toWireName('mcp.docs.get'), {}, ctx('c1'));
    const id = idIn(first.content)!;
    expect(stripMarks(first.content)).toContain('…[cut at 2000 of 3000 characters: tools__read_more with id');
    const more = await execute(opts, tools, toWireName('tools.read_more'), { id }, ctx('c1'));
    expect(stripMarks(more.content)).toBe(`<untrusted_tool_result tool="mcp.docs.get">\n${'e'.repeat(1000)}\n</untrusted_tool_result>`);
  });
});
