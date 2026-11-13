// tools.read_more: the next part of a tool result or an attached file cut for length, by the id its
// note gives (core/kept-results). Offered to every agent, as agents.ask (background/run-setup).
import { readKept } from '../core/kept-results';
import { wrappedResultMax } from '../core/limits';
import { stripMarks, text } from '../core/model-texts';
import type { Tool } from '../core/types';
import { defineTool, fields, optFinite } from './define';

const READ_MORE_TOOL = 'tools.read_more';

// The `from` parameter of the tools that read on after a cut (also browser.get_page_text, web.read):
// its description read when sent, so an edited text (param.from) applies to tools built before.
export const fromParam = {
  type: 'number',
  get description() {
    return stripMarks(text('param.from'));
  },
} as const;

export function readMoreTool(): Tool {
  return defineTool({
    name: READ_MORE_TOOL,
    // Not marked: tool definitions are listed in the panel and are not colored anywhere.
    description: stripMarks(text('tools.read_more_description')),
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' }, from: fromParam },
      required: ['id'],
    },
    // A read that may be made again (context/in-run shortens its older results like any other's).
    source: 'browser',
    effect: 'read',
    args: (raw) => ({ id: String(fields(raw).id), from: optFinite(fields(raw).from) }),
    run: async ({ id, from }, ctx) => {
      const kept = readKept(ctx.conversationId, id, wrappedResultMax(), from);
      if (!kept) return { type: 'text', text: text('result.read_more_gone'), isError: true };
      return { type: 'text', text: text('result.read_more', { tool: kept.source, part: kept.part }) };
    },
  });
}
