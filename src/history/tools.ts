// Tools to look into the saved conversations: search them and read one. Read-only, and what they
// return goes as untrusted (history/read).
import { countArg, defineTool, fields } from '../tools/define';
import { text } from '../core/model-texts';
import type { Tool } from '../core/types';
import { HISTORY_READ, HISTORY_SEARCH } from './names';
import { findConversation, readBlock, searchResult } from './read';

const MAX_RESULTS = 10;

// history.read's: in full only when asked for with true (as the confirmation is).
const readArgs = (raw: unknown) => ({ id: String(fields(raw).id), full: fields(raw).full === true });

export function historyTools(): Tool[] {
  return [
    defineTool({
      name: HISTORY_SEARCH,
      description:
        "Searches the user's saved conversations in this browser and lists the best matches first (by relevance: not every word must appear), each with its id and a snippet. " +
        'Use it when the user refers to something from an earlier conversation; try synonyms or the other language if nothing fits. ' +
        'Put words in quotes for an exact phrase. Then read one with history__read.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for; "a phrase in quotes" must appear as written' },
          limit: { type: 'number', description: `How many to list (default 5, at most ${MAX_RESULTS})` },
        },
        required: ['query'],
      },
      source: 'history',
      effect: 'read',
      args: (raw) => ({ query: String(fields(raw).query), limit: fields(raw).limit }),
      run: async ({ query, limit }, ctx) => {
        const n = countArg(limit, 5, MAX_RESULTS);
        return { type: 'text', text: await searchResult(query, n, ctx.conversationId) };
      },
    }),
    defineTool({
      name: HISTORY_READ,
      description:
        'Reads a saved conversation by its id (from history__search): what the user and you wrote, and the tools used. ' +
        'With full: true it also includes the tool results and the page content attached to the messages (much longer).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          full: { type: 'boolean', description: 'Also the tool results and the attached page content' },
        },
        required: ['id'],
      },
      source: 'history',
      effect: 'read',
      // In full it carries tool results and page content from any site: the user confirms it.
      alwaysAsk: (raw) => readArgs(raw).full,
      args: readArgs,
      describe: async ({ id }) => ({ summary: `Read the saved conversation ${id} in full (its tool results and attached page content)` }),
      run: async ({ id, full }) => {
        const conv = await findConversation(id);
        if (!conv) return { type: 'text', text: text('result.history_not_found', { id }), isError: true };
        return { type: 'text', text: readBlock(conv, full) };
      },
    }),
  ];
}
