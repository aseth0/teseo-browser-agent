// A tool's result as JSON, for the chat's Text | JSON switch (ToolCallView): the JSON object or array
// it holds (all of it, or between what wraps it, e.g. an <untrusted_…> block), pretty-printed, with
// what comes before and after it, and whether any of it came from the web. Only what parses: a result
// cut at a size limit is no longer JSON, and stays text. What the model gets does not change.
import { MARKS, stripMarks } from '../../core/origin-marks';

interface ToolJson {
  before: string; // e.g. the opening <untrusted_page_content …> tag
  json: string; // indented
  after: string;
  fromWeb: boolean; // inside an untrusted block, or marked as the web's (page, template, MCP, tool…)
}

// Past this, no JSON view: parsing and coloring would be slow, and results are cut well before it.
export const TOOL_JSON_MAX = 200_000;

const WEB_MARKS = [MARKS.page, MARKS.template, MARKS.skillValues, MARKS.tool, MARKS.mcp, MARKS.history].map(([open]) => open);

export function toolJson(content: string): ToolJson | undefined {
  if (content.length > TOOL_JSON_MAX) return undefined;
  const text = stripMarks(content);
  const start = text.search(/[[{]/);
  if (start < 0) return undefined;
  const end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  if (end < start) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== 'object') return undefined;
  const before = text.slice(0, start).trim();
  const after = text.slice(end + 1).trim();
  const fromWeb = /<untrusted_/i.test(before) || WEB_MARKS.some((m) => content.includes(m));
  return { before, json: JSON.stringify(parsed, null, 2), after, fromWeb };
}
