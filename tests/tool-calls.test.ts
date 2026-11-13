import { describe, expect, it } from 'vitest';
import { wireArgsError } from '../src/core/tool-args';
import { completionToolCalls, parseArgs, ToolCallAccumulator, type WireToolCall } from '../src/providers/tool-calls';

const accumulate = (fragments: WireToolCall[]) => {
  const calls = new ToolCallAccumulator();
  for (const f of fragments) calls.push(f);
  return calls.events();
};
const call = (id: string, name: string, args: unknown) => ({ type: 'tool-call', id, name, args });

describe('ToolCallAccumulator', () => {
  it('joins fragments by index', () => {
    expect(
      accumulate([
        { index: 0, id: 'a', function: { name: 'browser__open', arguments: '{"url":' } },
        { index: 1, id: 'b', function: { name: 'browser__find', arguments: '{}' } },
        { index: 0, function: { arguments: '"https://example.com"}' } },
      ]),
    ).toEqual([call('a', 'browser__open', { url: 'https://example.com' }), call('b', 'browser__find', {})]);
  });

  it('places a fragment with no index by its id, else with the call being written', () => {
    expect(
      accumulate([
        { id: 'a', function: { name: 'browser__type', arguments: '{"text":' } },
        { id: 'b', function: { name: 'browser__find', arguments: '{"query":"x"}' } },
        { id: 'a', function: { arguments: '"hi"}' } },
        { id: 'c', function: { name: 'browser__click' } },
        { function: { arguments: '{"ref":"ref_1"}' } },
      ]),
    ).toEqual([call('a', 'browser__type', { text: 'hi' }), call('b', 'browser__find', { query: 'x' }), call('c', 'browser__click', { ref: 'ref_1' })]);
  });

  it('merges arguments sent under another index and id into the call they belong to', () => {
    expect(
      accumulate([
        { index: 0, id: 'chatcmpl-tool-1', function: { name: 'custom_tools__try', arguments: '' } },
        { index: 1, id: 'chatcmpl-tool-2', function: { arguments: '{"name":"demo","base":"https://example.com"}' } },
      ]),
    ).toEqual([call('chatcmpl-tool-1', 'custom_tools__try', { name: 'demo', base: 'https://example.com' })]);
  });

  it('starts a new call when one comes under an index already taken, with its own id and name', () => {
    expect(
      accumulate([
        { index: 0, id: 'a', function: { name: 'browser__find', arguments: '{"query":"x"}' } },
        { index: 0, id: 'b', function: { name: 'browser__click', arguments: '{"ref":"ref_2"}' } },
      ]),
    ).toEqual([call('a', 'browser__find', { query: 'x' }), call('b', 'browser__click', { ref: 'ref_2' })]);
  });

  it('drops an empty duplicate of a call made with arguments in the same response: no id of its own', () => {
    expect(
      accumulate([
        { index: 0, id: 'a', function: { name: 'custom_tools__try', arguments: '{"name":"demo"}' } },
        { index: 1, function: { name: 'custom_tools__try', arguments: '{}' } },
      ]),
    ).toEqual([call('a', 'custom_tools__try', { name: 'demo' })]);
  });

  it('keeps a call with no arguments, its own id, beside one to the same tool with arguments', () => {
    expect(
      accumulate([
        { index: 0, id: 'a', function: { name: 'browser__read_page', arguments: '{"ref":"ref_4"}' } },
        { index: 1, id: 'b', function: { name: 'browser__read_page', arguments: '{}' } },
      ]),
    ).toEqual([call('a', 'browser__read_page', { ref: 'ref_4' }), call('b', 'browser__read_page', {})]);
  });

  it('keeps an argless call of a tool no other call in the response has', () => {
    expect(accumulate([{ index: 0, id: 'a', function: { name: 'browser__screenshot', arguments: '' } }])).toEqual([call('a', 'browser__screenshot', {})]);
  });

  it('drops a fragment with neither a name nor arguments', () => {
    expect(accumulate([{ index: 0, id: 'a' }, { index: 1, function: {} }])).toEqual([]);
  });

  it('reads arguments a server sends as an object', () => {
    expect(accumulate([{ index: 0, id: 'a', function: { name: 'browser__find', arguments: { query: 'x' } } }])).toEqual([call('a', 'browser__find', { query: 'x' })]);
  });

  it('keeps arguments that are not JSON as they came, for the call to be answered with them', () => {
    const [evt] = accumulate([{ index: 0, id: 'a', function: { name: 'browser__type', arguments: '{"text": "a\nb"' } }]);
    const err = wireArgsError({ type: 'object' }, evt?.type === 'tool-call' ? evt.args : undefined);
    expect(err?.reason).toBe('arguments not JSON');
    expect(err?.content).toContain('«{"text": "a\nb"»');
  });
});

describe('completionToolCalls', () => {
  it('applies the same rules to a complete body', () => {
    expect(
      completionToolCalls([
        { id: 'a', function: { name: 'agents__save', arguments: '{"name":"x"}' } },
        { id: 'a', function: { name: 'agents__save', arguments: '' } },
        { function: {} },
      ]),
    ).toEqual([call('a', 'agents__save', { name: 'x' })]);
    expect(
      completionToolCalls([
        { id: 'a', function: { name: 'browser__read_page', arguments: '{"ref":"ref_4"}' } },
        { id: 'b', function: { name: 'browser__read_page', arguments: '' } },
      ]),
    ).toEqual([call('a', 'browser__read_page', { ref: 'ref_4' }), call('b', 'browser__read_page', {})]);
  });
});

describe('wireArgsError', () => {
  const schema = { type: 'object', properties: { name: { type: 'string' }, base: { type: 'string' } }, required: ['name', 'base'] };
  it('says a call with no arguments for a tool that requires some arrived empty', () => {
    expect(wireArgsError(schema, parseArgs(''))).toMatchObject({ reason: 'no arguments', content: expect.stringContaining('requires name, base') });
  });
  it('leaves other calls to the schema check', () => {
    expect(wireArgsError(schema, { name: 'x' })).toBeUndefined();
    expect(wireArgsError({ type: 'object' }, {})).toBeUndefined();
  });
});
