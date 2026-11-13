// A text part's `shown` is how the chat shows it: never sent, nor counted as sent.
import { describe, expect, it } from 'vitest';
import { partTokens } from '../src/context/budget';
import type { Message, Part } from '../src/core/types';
import { toOpenAIMessages } from '../src/providers/wire';
import { typedText } from '../src/ui/chat/turns';

const wrapped = 'Explain <untrusted_page_content source="input">PLATYPUS</untrusted_page_content>';
const part: Part = { type: 'text', text: wrapped, shown: 'Explain PLATYPUS' };
const message: Message = { role: 'user', parts: [part] };

describe("a text part's shown text", () => {
  it('is what the chat shows of your message', () => {
    expect(typedText(message)).toBe('Explain PLATYPUS');
  });

  it('never goes to the model, nor into the estimate of what is sent', () => {
    const sent = JSON.stringify(toOpenAIMessages(undefined, [message]));
    expect(sent).toContain('untrusted_page_content');
    expect(sent).not.toContain('Explain PLATYPUS');
    expect(partTokens(part)).toBe(partTokens({ type: 'text', text: wrapped }));
  });
});
