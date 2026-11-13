import { describe, expect, it } from 'vitest';
import { modelView } from '../src/context/compaction';
import { pieceLabel } from '../src/context/pieces';
import type { Message } from '../src/core/types';
import { toCallViews } from '../src/ui/calls/calls';

const part = (source: string | undefined, context: 'page' | 'skill' | 'tool' | undefined = 'page') => ({ type: 'text' as const, text: 'x', context, source });

describe('the pieces of a message, in Layers', () => {
  it('are named by what they are', () => {
    expect(pieceLabel({ type: 'text', text: 'hi' })).toBe('Your message');
    expect(pieceLabel(part('shop-buy', 'skill'))).toBe('Site skill "shop-buy"');
    expect(pieceLabel(part(undefined, 'skill'))).toBe('Site skill reminder');
    expect(pieceLabel(part('skill-mention:summarize-page', 'skill'))).toBe('Skill mention /summarize-page');
    expect(pieceLabel(part('tool-mention:browser.find,user.ask', 'tool'))).toBe('Tool mention $browser.find $user.ask');
    expect(pieceLabel(part('mention:todoist/today'))).toBe('Mention ::todoist/today');
    expect(pieceLabel(part('mention-failed:todoist/nope'))).toBe('Mention ::todoist/nope (not read)');
    expect(pieceLabel(part('history-mention:about-lamps:About lamps'))).toBe('Saved conversation #about-lamps');
    expect(pieceLabel(part('history-auto:aaaa:72:About lamps'))).toBe('Saved conversation (auto) #about-lamps · 72%');
    expect(pieceLabel(part('template:youtube/videos'))).toBe('Site template "youtube" · videos');
    expect(pieceLabel(part('skill-values:shop-buy'))).toBe('Site skill values "shop-buy"');
    expect(pieceLabel(part('page-block'))).toBe('Page block');
    expect(pieceLabel(part(undefined))).toBe('Attached context');
  });

  it('line up with the messages of each call', () => {
    const history: Message[] = [
      { role: 'user', parts: [{ type: 'text', text: 'hello' }, { type: 'text', text: '<page/>', context: 'page', source: 'page-block' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'user', parts: [{ type: 'text', text: 'again' }] },
    ];
    const off: Message = { role: 'user', parts: [{ type: 'text', text: 'x' }], pageSkipped: 'off' };
    const [only] = toCallViews([{ title: '1', why: '', history: [off], at: 1 }], { system: 's', specs: [], head: {}, view: modelView });
    expect(only!.pieces[1]?.nothingAttached).toBe('Nothing attached: "Page" was off, and no site skill, template or mention applied.');
    const [, second] = toCallViews(
      [{ title: '1', why: '', history: history.slice(0, 1), at: 1 }, { title: '2', why: '', history, at: 3 }],
      { system: 'sys', specs: [], head: {}, view: modelView },
    );
    expect(second!.pieces.map((p) => p?.list.map((x) => x.label))).toEqual([undefined, ['Your message', 'Page block'], undefined, ['Your message']]);
    // The second went without anything attached; the first had the page.
    expect(second!.pieces.map((p) => p?.nothingAttached)).toEqual([undefined, undefined, undefined, 'Nothing attached: no page block, site skill, template or mention.']);
  });
});

describe('the calls of a conversation, in Layers', () => {
  const user = (text: string, change: Partial<Message> = {}): Message => ({ role: 'user', parts: [{ type: 'text', text }], ...change });
  const answer = (text: string, change: Partial<Message> = {}): Message => ({ role: 'assistant', parts: [{ type: 'text', text }], ...change });
  const history = [user('one'), answer('ok', { stopped: true }), user('two'), answer('ok'), user('three')];
  const calls = [1, 3, 5].map((at, i) => ({ title: `${i + 1}`, why: '', history: history.slice(0, at), at }));

  it('count what each one resends of the call before, with its own system prompt', () => {
    expect(toCallViews(calls, { system: 's', specs: [], head: {}, view: modelView }).map((c) => c.resent)).toEqual([0, 2, 4]);
    // Another agent's system prompt from the second call on: the same messages resent.
    const views = toCallViews(calls, (call) => ({ system: call.at > 1 ? 'other' : 's', specs: [], head: {}, view: modelView }));
    expect(views.map((c) => c.resent)).toEqual([0, 2, 4]);
    expect(toCallViews(calls, (call) => ({ system: call.at > 1 ? '' : 's', specs: [], head: {}, view: modelView })).map((c) => c.resent)).toEqual([0, 1, 3]);
  });

  it('note the turn you stopped before the message that followed it', () => {
    const [, second] = toCallViews(calls, { system: 's', specs: [], head: {}, view: modelView });
    expect(second!.pieces.map((p) => p?.list.map((x) => x.label))).toEqual([undefined, ['Your message'], undefined, ['Previous turn stopped', 'Your message']]);
  });
});
