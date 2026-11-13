import { describe, expect, it } from 'vitest';
import { MARKS } from '../src/core/origin-marks';
import { toolJson, TOOL_JSON_MAX } from '../src/ui/chat/tool-json';

describe("a tool result's JSON view", () => {
  it('finds a JSON object or array, all of it or inside what wraps it', () => {
    expect(toolJson('{"a":1,"b":[1,2]}')).toEqual({ before: '', json: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}', after: '', fromWeb: false });
    expect(toolJson('[1, 2]')?.json).toBe('[\n  1,\n  2\n]');
    const wrapped = toolJson('<untrusted_mcp_result source="x.example.test">\n{"ok":true}\n</untrusted_mcp_result>');
    expect(wrapped).toMatchObject({ before: '<untrusted_mcp_result source="x.example.test">', json: '{\n  "ok": true\n}', after: '</untrusted_mcp_result>', fromWeb: true });
  });

  it("says when it came from the web by its marks, which it leaves out of the JSON", () => {
    const [open, close] = MARKS.tool;
    const marked = toolJson(`{"title":"${open}Buy now${close}"}`);
    expect(marked).toMatchObject({ json: '{\n  "title": "Buy now"\n}', fromWeb: true });
    const [mine, mineClose] = MARKS.extension;
    expect(toolJson(`{"note":"${mine}x${mineClose}"}`)?.fromWeb).toBe(false);
  });

  it('none for text, a scalar, a result cut short, or one too big', () => {
    expect(toolJson('clicked the button')).toBeUndefined();
    expect(toolJson('42')).toBeUndefined();
    expect(toolJson('"just a string"')).toBeUndefined();
    expect(toolJson('{"a": [1, 2, 3…[truncated]')).toBeUndefined();
    expect(toolJson('- button "Buy now" [ref_9]')).toBeUndefined();
    expect(toolJson(`[${'1,'.repeat(TOOL_JSON_MAX / 2)}1]`)).toBeUndefined();
  });
});
