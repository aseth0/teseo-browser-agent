import { describe, expect, it } from 'vitest';
import { checkArgs, coerceArgs, problemLine } from '../src/core/tool-args';

const lines = (s: Record<string, unknown>, args: unknown) => checkArgs(s, args).invalid.map(problemLine);

const schema = {
  type: 'object',
  properties: {
    count: { type: 'integer' },
    ratio: { type: 'number' },
    submit: { type: 'boolean' },
    text: { type: 'string' },
    direction: { type: 'string', enum: ['up', 'down'] },
    tabId: { type: 'number' },
    tags: { type: 'array', items: { type: 'string' } },
    ids: { type: 'array', items: { type: 'number' } },
    raw: { type: 'array' },
    options: { type: 'object', properties: { url: { type: 'string' }, depth: { type: 'number' } }, required: ['url'] },
    either: { anyOf: [{ type: 'number' }, { type: 'string' }] },
  },
  required: ['text'],
};

describe('coerceArgs', () => {
  it('reads numbers and yes/no sent as text', () => {
    expect(coerceArgs(schema, { count: '5', ratio: ' -0.5 ', submit: 'TRUE' })).toEqual({ count: 5, ratio: -0.5, submit: true });
  });
  it('leaves text that is no number or yes/no as it came', () => {
    expect(coerceArgs(schema, { count: 'ten', submit: 'yes' })).toEqual({ count: 'ten', submit: 'yes' });
  });
  it('gives text where text is asked for', () => {
    expect(coerceArgs(schema, { text: 42, direction: false })).toEqual({ text: '42', direction: 'false' });
  });
  it('makes one value a list when it is what the list holds', () => {
    expect(coerceArgs(schema, { tags: 'news', ids: '7' })).toEqual({ tags: ['news'], ids: [7] });
    expect(coerceArgs(schema, { raw: 'a, b' })).toEqual({ raw: 'a, b' }); // the list says nothing of what it holds
  });
  it('matches an option written in another case, only when one matches', () => {
    expect(coerceArgs(schema, { direction: ' Down' })).toEqual({ direction: 'down' });
    expect(coerceArgs(schema, { direction: 'left' })).toEqual({ direction: 'left' });
  });
  it('renames an argument written in another case or style, unless the right one is given too', () => {
    expect(coerceArgs(schema, { tab_id: '3' })).toEqual({ tabId: 3 });
    expect(coerceArgs(schema, { tab_id: 3, tabId: 4 })).toEqual({ tab_id: 3, tabId: 4 });
  });
  it('leaves out null for a value that may not be null', () => {
    expect(coerceArgs(schema, { text: 'a', count: null })).toEqual({ text: 'a' });
  });
  it('goes into objects and lists', () => {
    expect(coerceArgs(schema, { options: { url: 'https://example.com', depth: '2' } })).toEqual({ options: { url: 'https://example.com', depth: 2 } });
    expect(coerceArgs(schema, { options: '{"url": "https://example.com"}' })).toEqual({ options: { url: 'https://example.com' } });
    expect(coerceArgs(schema, { ids: ['1', 2] })).toEqual({ ids: [1, 2] });
  });
  it('takes a property under anyOf as it comes, and gives back the same object when nothing changes', () => {
    const args = { either: '5', text: 'a', other: '1' };
    expect(coerceArgs(schema, args)).toBe(args);
  });
});

describe('checkArgs', () => {
  it('finds the required arguments left out, null as left out', () => {
    expect(checkArgs(schema, {})).toEqual({ missing: ['text'], invalid: [] });
    expect(checkArgs(schema, { text: null })).toEqual({ missing: ['text'], invalid: [] });
  });
  it('says where a value of another type is, and what it got', () => {
    expect(lines(schema, { text: 'a', count: 'ten', tags: [1] })).toEqual([
      'count: expected integer, got string "ten"',
      'tags[0]: expected string, got number 1',
    ]);
  });
  it('says the options of a value not among them', () => {
    expect(lines(schema, { text: 'a', direction: 'left' })).toEqual(['direction: "left" is not one of up, down']);
  });
  it('checks inside objects, their required values too', () => {
    expect(lines(schema, { text: 'a', options: { depth: 'deep' } })).toEqual(['options.url: required, left out', 'options.depth: expected number, got string "deep"']);
  });
  it('names the argument a misspelt one is close to, and ignores others unless the schema takes no more', () => {
    expect(lines(schema, { text: 'a', directon: 'up', whatever: 1 })).toEqual(['directon: unknown argument; did you mean direction?']);
    const closed = { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false };
    expect(lines(closed, { b: 'x' })).toEqual(['b: unknown argument; it takes a']);
  });
  it('takes what fits, and anything for a schema without types', () => {
    expect(checkArgs(schema, { text: 'a', count: 2.5, either: [1], options: { url: 'u' } })).toEqual({ missing: [], invalid: [] });
    expect(checkArgs({}, { anything: 1 })).toEqual({ missing: [], invalid: [] });
  });
});
