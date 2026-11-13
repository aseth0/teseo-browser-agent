import { describe, expect, it } from 'vitest';
import type { Message } from '../src/core/types';
import type { Settings } from '../src/storage/settings';
import { answerToRead, readsAnswers } from '../src/ui/chat/auto-read';

// Answers read aloud on their own as their turn ends: where Settings → Speak says, and which answer.
const on = (autoRead: NonNullable<Settings['speak']>['autoRead']) => ({ speak: { autoRead } }) as Pick<Settings, 'speak'>;
const user = (text: string, agent?: string): Message => ({ role: 'user', parts: [{ type: 'text', text }], ...(agent && { agent }) }) as Message;
const said = (text: string, more: Partial<Message> = {}): Message => ({ role: 'assistant', parts: [{ type: 'text', text }], ...more }) as Message;

describe('where answers are read on their own', () => {
  it('off by default, and each place on its own', () => {
    expect(readsAnswers({}, 'panel', () => true)).toBe(false);
    expect(readsAnswers(on({ panel: true }), 'panel', () => true)).toBe(true);
    expect(readsAnswers(on({ panel: true }), 'floating', () => true)).toBe(false);
    expect(readsAnswers(on({ floating: true }), 'floating', () => true)).toBe(true);
    expect(readsAnswers(on({ panel: true, floating: true }), undefined, () => true)).toBe(false);
  });

  it('in the Agents Panel: the chat shown, or every chat', () => {
    expect(readsAnswers(on({ panel: true }), 'manager', () => true)).toBe(false);
    expect(readsAnswers(on({ manager: 'shown' }), 'manager', () => true)).toBe(true);
    expect(readsAnswers(on({ manager: 'shown' }), 'manager', () => false)).toBe(false);
    expect(readsAnswers(on({ manager: 'all' }), 'manager', () => false)).toBe(true);
  });
});

describe('the answer read', () => {
  it("the last turn's answer, as its 🔊 reads it, with the agent it went to", () => {
    const found = answerToRead([user('Hi'), said('Old.'), user('Sum it up', 'research'), said('## Summary\n\nPrices **rose**.\n\n```js\nx()\n```')]);
    expect(found?.text).toContain('Prices rose.');
    expect(found?.text).not.toContain('x()');
    expect(found?.agentId).toBe('research');
  });

  it('none for a turn the user stopped, one that ended without an answer, or an empty history', () => {
    expect(answerToRead([user('Hi'), said('Half an ans', { stopped: true })])).toBeUndefined();
    expect(answerToRead([user('Hi')])).toBeUndefined();
    expect(answerToRead([])).toBeUndefined();
  });
});
