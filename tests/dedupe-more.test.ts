import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { dedupeContext, dedupeOf } = await import('../src/context/dedupe');
const { compactedView } = await import('../src/context/compaction');
const { fileSource, MENTION_SOURCE, recordingSource } = await import('../src/context/sources');
const { text } = await import('../src/core/model-texts');
type Message = import('../src/core/types').Message;
type Part = import('../src/core/types').Part;

// A ::site mention unchanged since the last one, and a file, recording or image of yours attached again, go as a note.
const cfg = dedupeOf(undefined);
const user = (...parts: Part[]): Message => ({ role: 'user', parts: [{ type: 'text', text: 'again' }, ...parts] });
const reply: Message = { role: 'assistant', parts: [{ type: 'text', text: 'ok' }] };
const ctx = (source: string, body: string): Part => ({ type: 'text', context: 'page', source, text: body });
const image: Part = { type: 'image', mediaType: 'image/png', data: 'AAAA' };
const unchanged = (what: string) => text('context.unchanged', { what });
const attached = (what: string) => text('context.already_attached', { what });
const partsOf = (messages: Message[], i: number) => messages[i]!.parts.slice(1);

describe("don't resend", () => {
  it('a ::site mention the same as the last one of it, not one that changed', () => {
    const m = (body: string) => ctx(`${MENTION_SOURCE}todoist/today`, body);
    const sent = dedupeContext([user(m('A')), reply, user(m('A')), reply, user(m('B')), reply, user(m('A'))], cfg);
    expect(partsOf(sent, 2)).toEqual([{ ...m('A'), text: unchanged('The site mention ::todoist/today') }]);
    expect(partsOf(sent, 4)).toEqual([m('B')]);
    expect(partsOf(sent, 6)).toEqual([m('A')]); // not the same as the last one
    expect(dedupeContext([user(m('A')), reply, user(m('A'))], dedupeOf({ siteValues: false }))[2]!.parts[1]).toEqual(m('A'));
  });

  it('a file, a recording or an image attached again, while the model sees the earlier one whole', () => {
    const file = ctx(fileSource('notes.txt'), 'NOTES');
    const rec = ctx(recordingSource('example.com', 3), 'CALLS');
    const history = [user(file, rec, image), reply, user(file, rec, image)];
    expect(partsOf(dedupeContext(history, cfg), 2)).toEqual([
      { ...file, text: attached('The file "notes.txt"') },
      { ...rec, text: attached('The recording of example.com (3 calls)') },
      { type: 'text', context: 'page', text: attached('Your image') },
    ]);
    expect(dedupeContext(history, dedupeOf({ attachments: false }))).toBe(history);
    // Another file of the same name with other content goes whole.
    const other = ctx(fileSource('notes.txt'), 'OTHER');
    expect(partsOf(dedupeContext([user(file), reply, user(other)], cfg), 2)).toEqual([other]);
  });

  it('goes whole again once compaction trimmed the earlier copy', () => {
    const file = ctx(fileSource('notes.txt'), 'N'.repeat(1000));
    const compaction = { at: 1, turns: 1, trimmed: { pages: true, toolResults: true, screenshots: true }, before: 1, after: 1 };
    const history: Message[] = [user(file, image), reply, { ...user(file, image), compaction }];
    const sent = dedupeContext(compactedView(history).messages, cfg);
    expect(partsOf(sent, 2)).toEqual([file, image]);
  });
});
