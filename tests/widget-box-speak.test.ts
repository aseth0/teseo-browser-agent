// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';
import type { WidgetState } from '../src/widget/ui/state';
import type { WidgetRunReply } from '../src/widget/protocol';

// The speaker on each text box of an action's card: a box of text has one, a list of links none; the
// user's click reads that box with the action named (the background picks its agent's voice), Stop while
// it is read; another box takes its place, the pill's end turns it back. With nothing to read with, it
// is crossed out and says what to add; a reading that could not start says why, in its box.
const onMessage = fakeEvent<(msg: unknown, sender: unknown, reply: (r: unknown) => void) => unknown>();
let answer: unknown = { started: true };
const sendMessage = vi.fn(async (_m: unknown): Promise<unknown> => answer);
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage, onMessage } } }));
const { result } = await import('../src/widget/ui/result');
const { createBoxSpeak, NOTHING_TO_READ_WITH } = await import('../src/widget/ui/box-speak');
const { SPEAK_GROW, SPEAK_PILL, SPEAK_STOP, SPEAK_TEXT, SPEAK_UNQUEUE } = await import('../src/speech/protocol');

// Clicks made as the user's (jsdom cannot: isTrusted), as tests/widget-speak does.
const byUser = new WeakSet<Event>();
const add = EventTarget.prototype.addEventListener;
EventTarget.prototype.addEventListener = function (type: string, listener: EventListenerOrEventListenerObject | null, options?: boolean | AddEventListenerOptions) {
  if (!listener) return;
  const call = typeof listener === 'function' ? listener : (e: Event) => listener.handleEvent(e);
  add.call(this, type, (e: Event) => call.call(this, byUser.has(e) ? new Proxy(e, { get: (t, k) => (k === 'isTrusted' ? true : typeof Reflect.get(t, k) === 'function' ? Reflect.get(t, k).bind(t) : Reflect.get(t, k)) }) : e), options);
};
const userClick = (b: HTMLElement) => {
  const e = new MouseEvent('click', { bubbles: true });
  byUser.add(e);
  b.dispatchEvent(e);
};
const settled = () => new Promise((r) => setTimeout(r, 0));
const REPLY: WidgetRunReply = { outputs: [
  { label: 'Summary', lines: [], text: 'Prices rose.' },
  { label: 'Tone', lines: [], text: 'Calm.' },
  { label: 'Links', lines: [{ text: 'Report', href: 'https://example.com/r' }] },
] };
const card = (speakBoxes: WidgetState['speakBoxes']) => {
  const speaker = createBoxSpeak({ speakBoxes } as WidgetState);
  const node = result(REPLY, vi.fn(), () => document.body, undefined, { actionId: 'act', speaker }) as HTMLElement;
  document.body.replaceChildren(node);
  const boxes = [...node.querySelectorAll('section.box')] as HTMLElement[];
  return { boxes, speakerOf: (i: number) => boxes[i]!.querySelector<HTMLButtonElement>('button.speak') };
};

beforeEach(() => {
  sendMessage.mockClear();
  answer = { started: true };
});

describe('the speakers', () => {
  it('only on boxes of text, and none when Speak or the button is off', () => {
    const { speakerOf } = card('on');
    expect(speakerOf(0)?.title).toBe('Read Summary aloud');
    expect(speakerOf(1)).not.toBeNull();
    expect(speakerOf(2)).toBeNull();
    expect(card(undefined).speakerOf(0)).toBeNull();
  });

  it("reads its box with the action named, Stop while it is read; another box's takes its place", async () => {
    const { speakerOf } = card('on');
    userClick(speakerOf(0)!);
    await settled();
    expect(sendMessage).toHaveBeenCalledWith({ type: SPEAK_TEXT, text: 'Prices rose.', action: 'act', box: 0 });
    expect(speakerOf(0)!.title).toBe('Stop reading Summary');
    userClick(speakerOf(1)!);
    await settled();
    expect(speakerOf(0)!.title).toBe('Read Summary aloud');
    expect(speakerOf(1)!.title).toBe('Stop reading Tone');
    userClick(speakerOf(1)!);
    await settled();
    expect(sendMessage).toHaveBeenLastCalledWith({ type: SPEAK_STOP });
    expect(speakerOf(1)!.title).toBe('Read Tone aloud');
  });

  it("turns back once the reading ends (the pill's end)", async () => {
    const { speakerOf } = card('on');
    userClick(speakerOf(0)!);
    await settled();
    onMessage.emit({ type: SPEAK_PILL, off: true }, {}, () => undefined);
    expect(speakerOf(0)!.title).toBe('Read Summary aloud');
  });

  it('a reading that could not start says why, in its box', async () => {
    answer = { error: 'The provider cannot be reached.' };
    const { boxes, speakerOf } = card('on');
    userClick(speakerOf(0)!);
    await settled();
    expect(boxes[0]!.querySelector('.speak-note')!.textContent).toBe('Not read aloud: The provider cannot be reached.');
    expect(speakerOf(0)!.title).toBe('Read Summary aloud');
  });

  it('with nothing to read with, crossed out: a click says what to add, and nothing is sent', async () => {
    const { boxes, speakerOf } = card('setup');
    expect(speakerOf(0)!.classList.contains('off')).toBe(true);
    userClick(speakerOf(0)!);
    await settled();
    expect(boxes[0]!.querySelector('.speak-note')!.textContent).toBe(NOTHING_TO_READ_WITH);
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it("not the page's clicks", async () => {
    const { speakerOf } = card('on');
    speakerOf(0)!.click();
    await settled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

// An action whose boxes are read on their own: once its card shows them, all its boxes of text are
// asked for in order, waiting their turn; a box that waits shows it; its card going drops them.
describe('boxes read on their own', () => {
  const autoCard = (more: Partial<WidgetState> = {}) => {
    const speaker = createBoxSpeak({ speakBoxes: 'on', canSpeak: true, ...more } as WidgetState);
    speaker.newCard?.();
    const node = result(REPLY, vi.fn(), () => document.body, undefined, { actionId: 'act', speaker }) as HTMLElement;
    document.body.replaceChildren(node);
    const boxes = [...node.querySelectorAll('section.box')] as HTMLElement[];
    return { speaker, boxes, speakerOf: (i: number) => boxes[i]!.querySelector<HTMLButtonElement>('button.speak') };
  };

  it('asks for its boxes of text in order, queued; the one that waits says so', async () => {
    const { speaker, speakerOf } = autoCard();
    speaker.readOnItsOwn?.('act');
    await settled();
    expect(sendMessage.mock.calls.map((c) => c[0])).toEqual([
      { type: SPEAK_TEXT, text: 'Prices rose.', action: 'act', box: 0, queued: true },
      { type: SPEAK_TEXT, text: 'Calm.', action: 'act', box: 1, queued: true },
    ]);
    onMessage.emit({ type: SPEAK_PILL, text: 'Reading', key: 'action:act:0', waiting: ['action:act:1'] }, {}, () => undefined);
    expect(speakerOf(0)!.title).toBe('Stop reading Summary');
    expect(speakerOf(1)!.title).toBe('Tone waits its turn: read it now');
    expect(speakerOf(1)!.classList.contains('waiting')).toBe(true);
    onMessage.emit({ type: SPEAK_PILL, text: 'Reading', key: 'action:act:1' }, {}, () => undefined);
    expect(speakerOf(0)!.title).toBe('Read Summary aloud');
    expect(speakerOf(1)!.title).toBe('Stop reading Tone');
  });

  it('reads them with the button on action boxes off too; not when Speak cannot read', async () => {
    autoCard({ speakBoxes: undefined }).speaker.readOnItsOwn?.('act');
    await settled();
    expect(sendMessage).toHaveBeenCalledTimes(2);
    sendMessage.mockClear();
    autoCard({ canSpeak: false }).speaker.readOnItsOwn?.('act');
    await settled();
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('its card going drops those that wait', async () => {
    const { speaker } = autoCard();
    speaker.readOnItsOwn?.('act');
    await settled();
    sendMessage.mockClear();
    speaker.drop?.();
    expect(sendMessage).toHaveBeenCalledWith({ type: SPEAK_UNQUEUE, prefix: 'action:' });
  });

  it('nothing to read with: said in the first box, and the others not asked for', async () => {
    answer = { error: 'Add a voice profile', settings: 'speak' };
    const { speaker, boxes } = autoCard();
    speaker.readOnItsOwn?.('act');
    await settled();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(boxes[0]!.querySelector('.speak-note')!.textContent).toBe('Not read aloud: Add a voice profile');
  });
});

describe('an answer read as it streams into the card', () => {
  const S = 'The prices rose this week in every store we checked, and most in small ones.';
  it('starts once its first piece is final, tells each next one, and ends it done', async () => {
    const speaker = createBoxSpeak({ speakBoxes: 'on', canSpeak: true, pieceSizes: { first: 40, rest: 60 } } as WidgetState);
    const stream = speaker.stream!('act')!;
    stream.grew('The prices');
    expect(sendMessage).not.toHaveBeenCalled();
    stream.grew(`${S} Bread`);
    await settled();
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: SPEAK_TEXT, action: 'act', box: 0, queued: true, growing: true }));
    stream.grew(`${S} Bread rose. Milk did too, and so did the rest of it all. Fr`);
    await settled();
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: SPEAK_GROW, key: 'action:act:0' }));
    expect(stream.end()).toBe(true);
    expect(sendMessage).toHaveBeenLastCalledWith(expect.objectContaining({ type: SPEAK_GROW, key: 'action:act:0', done: true }));
  });

  it('none when Speak cannot read', () => {
    expect(createBoxSpeak({ speakBoxes: 'on' } as WidgetState).stream!('act')).toBeUndefined();
  });
});
