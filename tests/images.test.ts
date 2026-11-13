import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { toOpenAIMessages } = await import('../src/providers/wire');
const { keptHistory } = await import('../src/history/store');
const { text } = await import('../src/core/model-texts');
type Message = import('../src/core/types').Message;

const withImage: Message = { role: 'user', parts: [{ type: 'text', text: 'what is this?' }, { type: 'image', mediaType: 'image/jpeg', data: 'AAAA' }] };

describe('the images you attach', () => {
  it('go after your text, as image_url parts', () => {
    expect(toOpenAIMessages(undefined, [withImage])).toEqual([{ role: 'user', content: [{ type: 'text', text: 'what is this?' }, { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } }] }]);
  });

  it('are not kept in a saved conversation: the model gets a note in their place', () => {
    const [kept] = keptHistory([withImage]);
    expect(kept!.parts[1]).toEqual({ type: 'image', mediaType: 'image/jpeg', data: '' });
    expect(toOpenAIMessages(undefined, [kept!])).toEqual([{ role: 'user', content: [{ type: 'text', text: `what is this?\n${text('user.image_not_kept')}` }] }]);
  });
});
