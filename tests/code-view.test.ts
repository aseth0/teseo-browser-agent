import { describe, expect, it } from 'vitest';
import { indentJson } from '../src/ui/CodeView';

describe('indentJson', () => {
  it('indents as JSON.stringify does, strings left as they are', () => {
    const value = { a: [1, { b: 'x, y: {z}', c: [] }], d: {}, e: 'say "hi"\\' };
    expect(indentJson(JSON.stringify(value))).toBe(JSON.stringify(value, null, 2));
  });

  it('indents an answer cut short, which is not valid JSON', () => {
    expect(indentJson('[{"name":"incident-42","purpose":"","total_msg_count":56},{"name":"inc')).toBe(
      '[\n  {\n    "name": "incident-42",\n    "purpose": "",\n    "total_msg_count": 56\n  },\n  {\n    "name": "inc',
    );
  });
});
