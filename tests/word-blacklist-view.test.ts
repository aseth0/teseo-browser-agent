import { describe, expect, it } from 'vitest';
import type { Message } from '../src/core/types';
import { maskedItems, replacedInMessage, replacedInResult } from '../src/ui/chat/replaced';
import { compileBlacklist } from '../src/word-blacklist/core';

const blacklist = compileBlacklist([{ term: 'Acme', replacement: 'CLIENT_A' }, { term: 'Globex', replacement: 'CLIENT_B' }]);
const result = { type: 'tool_result' as const, toolCallId: 'c', content: 'Globex found' };
const history: Message[] = [
  { role: 'user', parts: [{ type: 'text', text: 'before' }] },
  { role: 'assistant', parts: [{ type: 'text', text: 'plain' }] },
  { role: 'user', parts: [{ type: 'text', text: 'About Acme' }, { type: 'text', text: 'Acme on the page', context: 'page' }, { type: 'text', text: 'Globex', context: 'page', source: 'file:notes.txt' }] },
  { role: 'assistant', parts: [{ type: 'tool_call', id: 'c', name: 't', args: {} }], masked: true },
  { role: 'tool', parts: [result] },
  { role: 'assistant', parts: [{ type: 'text', text: 'done' }], masked: true },
];

describe('what the chat shows the word blacklist replaced', () => {
  const view = { blacklist, masked: maskedItems(history) };
  it('lists by where it was each term in a message that went masked', () => {
    expect(replacedInMessage(view, history[2]!)?.entries.map((e) => e.text)).toEqual(['Your message: Acme → CLIENT_A', 'Page: Acme → CLIENT_A', 'File notes.txt: Globex → CLIENT_B']);
    expect(replacedInResult(view, result)?.entries.map((e) => e.text)).toEqual(['Tool result: Globex → CLIENT_B']);
  });
  it('shows nothing for a message that did not go masked, or without terms', () => {
    expect(replacedInMessage(view, history[0]!)).toBeUndefined();
    expect(replacedInMessage({ masked: view.masked }, history[2]!)).toBeUndefined();
  });
});
