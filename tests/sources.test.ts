import { describe, expect, it } from 'vitest';
import { historyAutoOf, historyAutoSource, historyMentionOf, historyMentionSource } from '../src/context/sources';

describe('context part sources', () => {
  it('reads back what they encode, a title with colons too', () => {
    expect(historyAutoOf(historyAutoSource('id1', 72, 'Re: a: b'))).toEqual({ id: 'id1', match: 72, title: 'Re: a: b' });
    expect(historyMentionOf(historyMentionSource('re-a-b', 'Re: a: b'))).toEqual({ slug: 're-a-b', title: 'Re: a: b' });
  });

  it('are none for another source', () => {
    expect(historyAutoOf('history-mention:x:y')).toBeUndefined();
    expect(historyMentionOf(undefined)).toBeUndefined();
  });
});
