// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';
import type { WidgetState } from '../src/widget/ui/state';
import type { WidgetActionInfo } from '../src/widget/protocol';

// The page widget's button beside a selection: shown only while the bubble shows and Settings → Speak has
// it on, under the selection's end and away from a menu of the page's own; a click of the user's reads the
// selection, Stop while it is read; it goes when the bubble does.
const onMessage = fakeEvent<(msg: unknown, sender: unknown, reply: (r: unknown) => void) => unknown>();
const sendMessage = vi.fn(async (_m: unknown): Promise<unknown> => ({ started: true }));
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage, onMessage } } }));
let selected = '';
vi.mock('../src/speech/selection', () => ({ pageSelection: () => selected }));
// An action's run: held until the test answers it, its signal kept.
let runs: { request: unknown; signal?: AbortSignal; answer: (r: unknown) => void }[] = [];
vi.mock('../src/widget/client', () => ({
  runAction: (request: unknown, _handlers: unknown, signal?: AbortSignal) => new Promise((answer) => runs.push({ request, signal, answer })),
}));
const { createSpeakSelection, placeFor } = await import('../src/widget/ui/speak-selection');
const { createBoxSpeak } = await import('../src/widget/ui/box-speak');
const { WIDGET_TAG } = await import('../src/page/protocol');

// Its shadow root, as the user sees it; and clicks made as the user's (jsdom cannot: isTrusted).
const roots: ShadowRoot[] = [];
const attach = Element.prototype.attachShadow;
Element.prototype.attachShadow = function (init: ShadowRootInit) {
  const root = attach.call(this, init);
  roots.push(root);
  return root;
};
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
const rect = (left: number, top: number, w = 60, h = 16) => ({ left, top, right: left + w, bottom: top + h, width: w, height: h, x: left, y: top }) as DOMRect;
Object.defineProperty(window, 'innerWidth', { value: 1000, configurable: true });
Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
document.elementFromPoint = () => document.body;
vi.stubGlobal('getSelection', () => ({ rangeCount: selected ? 1 : 0, getRangeAt: () => ({ getClientRects: () => [rect(100, 100), rect(20, 120)], commonAncestorContainer: document.body }) }));

const state = (more: Partial<WidgetState> = {}) => ({ host: document.createElement('div'), speakButton: true, actions: [], ...more }) as WidgetState;
const button = () => (document.querySelector(WIDGET_TAG) ? roots.at(-1)!.querySelector('button')! : null);
const root = () => roots.at(-1)!;
// An action that opens the chat: opened.
const toChat = vi.fn(async (_what: unknown) => ({ opened: true }));
const create = (st: WidgetState) => createSpeakSelection(st, { toChat, theme: () => undefined, speaker: createBoxSpeak(st) });
afterEach(() => {
  document.querySelectorAll(WIDGET_TAG).forEach((h) => h.remove());
  sendMessage.mockClear();
  toChat.mockClear();
  runs = [];
  selected = '';
  vi.useRealTimers();
});
const escape = () => {
  const key = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true });
  byUser.add(key);
  document.dispatchEvent(key);
};
const pointerdown = (on: Element) => on.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));

describe('where it goes', () => {
  it('under the selection\'s end; elsewhere when the page has something there; nowhere off the window', () => {
    const rects = [rect(100, 100), rect(20, 120)];
    expect(placeFor(rects, () => true)).toEqual({ x: 82, y: 140 });
    expect(placeFor(rects, (x) => x > 90 ? false : x > 60)).toEqual({ x: 72, y: 120 });
    expect(placeFor(rects, () => false)).toBeUndefined();
    expect(placeFor([], () => true)).toBeUndefined();
  });
  it('a wider toolbar: the same spots for its width, free at both ends, or moved left into the window', () => {
    const rects = [rect(100, 100), rect(20, 120)];
    expect(placeFor(rects, () => true, 111)).toEqual({ x: 82, y: 140 });
    // Its far end over a menu of the page's: under the selection's start, to its left; under it, above.
    expect(placeFor([rect(300, 100), rect(20, 120)], (x) => x < 150 || x > 180, 111)).toEqual({ x: 187, y: 120 });
    expect(placeFor(rects, (_x, y) => y < 130, 111)).toEqual({ x: 100, y: 70 });
    // The selection ends near the window's right edge: under it, moved left.
    const right = [rect(900, 100, 90)];
    expect(placeFor(right, () => true, 111)).toEqual({ x: 900 - 111 - 2, y: 120 });
    expect(placeFor([rect(0, 0, 990)], () => true, 111)).toEqual({ x: 1000 - 111, y: 20 });
  });
  it('the speaker alone is not thrown to the window\'s right edge when its spots are taken', () => {
    expect(placeFor([rect(100, 100), rect(20, 120)], (_x, y) => y < 50)).toBeUndefined();
  });
});

describe('the button beside a selection', () => {
  it('reads the selection on the user\'s click, then is Stop until the reading ends', async () => {
    const speak = create(state());
    selected = 'Words picked on the page.';
    speak.follow();
    const b = button()!;
    expect(b.ariaLabel).toBe('Read the selection aloud');
    b.click(); // a page's script: nothing
    expect(sendMessage).not.toHaveBeenCalled();
    userClick(b);
    await Promise.resolve();
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser-agent:speak-text', text: 'Words picked on the page.' });
    expect(b.ariaLabel).toBe('Stop reading aloud');
    speak.start();
    onMessage.emit({ type: 'browser-agent:speak-pill', off: true }, {}, () => undefined); // the reading ended
    expect(b.ariaLabel).toBe('Read the selection aloud');
    userClick(b);
    await Promise.resolve();
    sendMessage.mockClear();
    userClick(button()!);
    expect(sendMessage).toHaveBeenCalledWith({ type: 'browser-agent:speak-stop' });
    speak.stop();
    expect(button()).toBeNull();
  });

  it('says why when it was not read', async () => {
    sendMessage.mockResolvedValueOnce({ error: 'Add a voice profile in Settings → Speak to read aloud.' });
    const speak = create(state());
    selected = 'Words.';
    speak.follow();
    userClick(button()!);
    await new Promise((r) => setTimeout(r, 0));
    expect(button()!.ariaLabel).toBe('Not read aloud: Add a voice profile in Settings → Speak to read aloud.');
    speak.stop();
  });

  it('none without the bubble, with it off in Settings → Speak, or with nothing selected', () => {
    selected = 'Words.';
    create(state({ host: undefined })).follow();
    expect(button()).toBeNull();
    create(state({ speakButton: false })).follow();
    expect(button()).toBeNull();
    selected = '';
    create(state()).follow();
    expect(button()).toBeNull();
  });
});

describe('the actions beside a selection', () => {
  const act = (id: string, more: Partial<WidgetActionInfo> = {}): WidgetActionInfo => ({ id, name: `Action ${id}`, input: 'selection', besideSelection: true, ...more });
  const marked = ['a', 'b', 'c', 'd', 'e'].map((id) => act(id));

  it('the speaker, then the marked ones, the fifth behind "…"; none unmarked', () => {
    const speak = create(state({ actions: [...marked, act('x', { besideSelection: undefined })] }));
    selected = 'Words.';
    speak.follow();
    const labels = [...root().querySelectorAll('.bar > button')].map((b) => b.ariaLabel);
    expect(labels).toEqual(['Read the selection aloud', 'Action a', 'Action b', 'Action c', 'Action d', 'More actions']);
    const more = root().querySelector<HTMLElement>('.sel-more')!;
    expect(more.hidden).toBe(true);
    userClick(root().querySelector<HTMLElement>('[aria-label="More actions"]')!);
    expect(more.hidden).toBe(false);
    expect([...more.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['AAction e']);
    speak.stop();
  });

  it('looks as always with none marked; the actions alone with the speaker off', () => {
    const speak = create(state({ actions: [act('x', { besideSelection: undefined })] }));
    selected = 'Words.';
    speak.follow();
    expect(root().querySelector('.bar')).toBeNull();
    expect(button()!.className).toBe('round');
    speak.stop();
    const alone = create(state({ speakButton: false, actions: [act('a', { openChat: true })] }));
    alone.follow();
    expect([...root().querySelectorAll('.bar > button')].map((b) => b.ariaLabel)).toEqual(['Action a (opens chat)']);
    alone.stop();
  });

  it('runs one with the selection, its card under the toolbar; Escape closes it and stops the run', async () => {
    const speak = create(state({ actions: [act('a'), act('t', { input: 'text' })] }));
    speak.start();
    selected = 'Words picked.';
    speak.follow();
    userClick(root().querySelector<HTMLElement>('[data-action="a"]')!);
    expect(runs.map((r) => r.request)).toEqual([{ id: 'a', input: 'Words picked.', reads: {} }]);
    const card = root().querySelector<HTMLElement>('.sel-card')!;
    expect(card.hidden).toBe(false);
    expect(card.style.top).toBe('32px');
    expect(card.querySelector('.pop-head')!.textContent).toContain('Action a · Words picked.');
    expect(root().querySelector('[data-action="a"]')!.classList.contains('on')).toBe(true);
    // A text action: at once with the selection, kept editable above the answer; the first run stopped.
    userClick(root().querySelector<HTMLElement>('[data-action="t"]')!);
    expect(runs[0]!.signal!.aborted).toBe(true);
    expect(runs[1]!.request).toEqual({ id: 't', input: 'Words picked.', reads: {} });
    expect(card.querySelector<HTMLInputElement>('.ask input')!.value).toBe('Words picked.');
    escape();
    expect(card.hidden).toBe(true);
    expect(runs[1]!.signal!.aborted).toBe(true);
    speak.stop();
  });

  it('its card goes with the selection, and when another is made', () => {
    const speak = create(state({ actions: [act('a')] }));
    speak.start();
    selected = 'Words.';
    speak.follow();
    userClick(root().querySelector<HTMLElement>('[data-action="a"]')!);
    const card = root().querySelector<HTMLElement>('.sel-card')!;
    // A press in the card (its text, its field): the selection it changes is the card's own.
    document.querySelector(WIDGET_TAG)!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true }));
    selected = '';
    speak.follow();
    expect(card.hidden).toBe(false);
    document.body.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, composed: true })); // a press on the page
    selected = 'Other words.';
    speak.follow();
    expect(card.hidden).toBe(true);
    expect(runs[0]!.signal!.aborted).toBe(true);
    selected = '';
    speak.follow();
    expect(document.querySelector(WIDGET_TAG)).toBeNull();
    speak.stop();
  });
});

describe('the actions beside a selection, as the page changes', () => {
  const act = (id: string, more: Partial<WidgetActionInfo> = {}): WidgetActionInfo => ({ id, name: `Action ${id}`, input: 'selection', besideSelection: true, ...more });

  it('the toolbar goes once its card closes and the selection is gone meanwhile', () => {
    vi.useFakeTimers();
    const speak = create(state({ actions: [act('a')] }));
    speak.start();
    selected = 'Words.';
    speak.follow();
    userClick(root().querySelector<HTMLElement>('[data-action="a"]')!);
    pointerdown(document.querySelector(WIDGET_TAG)!); // in the card: its own selection
    selected = '';
    speak.follow();
    expect(document.querySelector(WIDGET_TAG)).not.toBeNull();
    escape();
    vi.advanceTimersByTime(300);
    expect(document.querySelector(WIDGET_TAG)).toBeNull();
    speak.stop();
  });

  it('stopped with a card running: its run stops, nothing of it stays in the page', () => {
    const speak = create(state({ actions: [act('a')] }));
    speak.start();
    selected = 'Words.';
    speak.follow();
    userClick(root().querySelector<HTMLElement>('[data-action="a"]')!);
    speak.stop();
    expect(runs[0]!.signal!.aborted).toBe(true);
    expect(document.querySelector(WIDGET_TAG)).toBeNull();
  });

  it('runs one from the "…" list, and opens the chat with one that does', () => {
    const actions = ['a', 'b', 'c', 'd'].map((id) => act(id)).concat(act('e'), act('chat', { openChat: true }));
    const speak = create(state({ actions }));
    selected = 'Words.';
    speak.follow();
    userClick(root().querySelector<HTMLElement>('[aria-label="More actions"]')!);
    const more = root().querySelector<HTMLElement>('.sel-more')!;
    expect(more.className).toContain('start'); // the toolbar on the window's left: the list opens rightwards
    userClick(more.querySelector<HTMLElement>('[data-action="e"]')!);
    expect(more.hidden).toBe(true);
    expect(runs.map((r) => r.request)).toEqual([{ id: 'e', input: 'Words.', reads: {} }]);
    expect(root().querySelector('[aria-label="More actions"]')!.classList.contains('on')).toBe(true);
    userClick(root().querySelector<HTMLElement>('[aria-label="More actions"]')!);
    userClick(more.querySelector<HTMLElement>('[data-action="chat"]')!);
    expect(toChat).toHaveBeenCalledWith({ action: { id: 'chat', input: 'Words.', reads: {} } });
    expect(runs[0]!.signal!.aborted).toBe(true);
    speak.stop();
  });

  it('follows the page\'s actions as they change; a press runs the action as it is now', () => {
    const st = state({ actions: [act('a', { icon: '🅰' })] });
    const speak = create(st);
    selected = 'Words.';
    speak.follow();
    const old = root().querySelector<HTMLElement>('[data-action="a"]')!;
    expect(old.textContent).toBe('🅰');
    st.actions = [act('a', { icon: '✍', input: 'text' })];
    userClick(old); // its button not made again yet: the action as the page has it now
    expect(root().querySelector('.ask input')).not.toBeNull();
    speak.follow();
    expect(root().querySelector('[data-action="a"]')!.textContent).toBe('✍');
    st.actions = [];
    userClick(root().querySelector<HTMLElement>('[data-action="a"]')!); // gone: nothing runs
    expect(runs).toHaveLength(1);
    speak.follow();
    expect(root().querySelector('.bar')).toBeNull();
    speak.stop();
  });
});
