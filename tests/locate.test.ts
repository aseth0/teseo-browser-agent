// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { caretAtEnd, clearField, fieldText, focused, focusSpot, inputEnd, inputStart, keysSeenCount, locate, wheelAt } from '../src/content/locate';

const rect = (left: number, top: number, width: number, height: number) => ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top }) as DOMRect;
const boxes = (el: Element, list: DOMRect[]) => {
  el.getClientRects = () => list as unknown as DOMRectList;
};

beforeEach(() => {
  document.body.innerHTML = '<button id="b">OK</button><input id="i"><button id="top">Cover</button><button id="off" disabled>No</button>';
  Element.prototype.scrollIntoView = vi.fn();
});

const $ = (id: string) => document.getElementById(id)!;
const hitting = (el: Element | null) => {
  document.elementFromPoint = () => el;
};

describe('locate', () => {
  it('returns the center of the first visible box', () => {
    boxes($('b'), [rect(0, 0, 0, 0), rect(10, 10, 100, 20)]);
    hitting($('b'));
    expect(locate($('b'), {})).toMatchObject({ ok: true, x: 60, y: 20 });
  });

  it('returns the box in document coordinates', () => {
    boxes($('b'), [rect(10, 10, 100, 20)]);
    hitting($('b'));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 300 });
    expect(locate($('b'), {})).toEqual({ ok: true, x: 60, y: 20, box: { x: 10, y: 310, width: 100, height: 20 } });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 0 });
  });

  it('scrolls it into view at once, not smoothly: measured where it stays', () => {
    boxes($('b'), [rect(10, 10, 100, 20)]);
    hitting($('b'));
    locate($('b'), {});
    expect($('b').scrollIntoView).toHaveBeenCalledWith({ block: 'center', inline: 'center', behavior: 'instant' });
  });

  it('accepts a hit on something inside the element', () => {
    $('b').innerHTML = '<span id="s">OK</span>';
    boxes($('b'), [rect(10, 10, 100, 20)]);
    hitting($('s'));
    expect(locate($('b'), {})).toMatchObject({ ok: true, x: 60, y: 20 });
  });

  it('accepts a hit inside the shadow root of the element, or on its slotted label', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button id="sb"><slot></slot></button><span id="inner">x</span>';
    host.innerHTML = '<span id="label">Send</span>';
    const inner = shadow.getElementById('inner')!;
    const button = shadow.getElementById('sb')!;
    hitting(host);
    boxes(host, [rect(10, 10, 100, 20)]);
    (shadow as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => inner;
    expect(locate(host, {})).toMatchObject({ ok: true, x: 60, y: 20 });
    boxes(button, [rect(10, 10, 100, 20)]);
    (shadow as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => $('label');
    expect(locate(button, {})).toMatchObject({ ok: true, x: 60, y: 20 });
  });

  it('no box for a hidden element', () => {
    boxes($('b'), []);
    expect(locate($('b'), {})).toEqual({ ok: false, problem: 'no-box' });
  });

  it('covered names what is on top', () => {
    boxes($('b'), [rect(10, 10, 100, 20)]);
    hitting($('top'));
    const found = locate($('b'), {});
    expect(found).toMatchObject({ ok: false, problem: 'covered' });
    expect((found as { other: string }).other).toContain('Cover');
  });

  it('refuses a disabled element', () => {
    expect(() => locate($('off'), {})).toThrow('The element is disabled');
  });

  it('focuses when asked', () => {
    boxes($('i'), [rect(0, 0, 50, 10)]);
    hitting($('i'));
    locate($('i'), { focus: true });
    expect(document.activeElement).toBe($('i'));
  });

  it('finds an element inside an open shadow root', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<button>Inner</button>';
    const inner = shadow.querySelector('button')!;
    boxes(inner, [rect(10, 10, 100, 20)]);
    hitting(host); // the document retargets to the host
    (shadow as unknown as { elementFromPoint: () => Element }).elementFromPoint = () => inner;
    expect(locate(inner, {})).toMatchObject({ ok: true, x: 60, y: 20 });
  });

  it('in-frame for an element of another document', () => {
    const other = document.implementation.createHTMLDocument('frame');
    const el = other.createElement('button');
    other.body.appendChild(el);
    expect(locate(el, {})).toEqual({ ok: false, problem: 'in-frame' });
  });
});

describe('focused', () => {
  it('is fine on a field of this document', () => {
    $('i').focus();
    expect(focused()).toEqual({ ok: true });
  });

  it('refuses the focus inside a frame', () => {
    document.body.insertAdjacentHTML('beforeend', '<iframe id="f"></iframe>');
    Object.defineProperty(document, 'activeElement', { configurable: true, get: () => $('f') });
    expect(focused()).toEqual({ ok: false, problem: 'in-frame' });
    delete (document as unknown as { activeElement?: unknown }).activeElement;
  });

  it('refuses the focus inside our own floating chat or card, which keys would type into', () => {
    const host = document.createElement('ba-widget');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = '<textarea></textarea>';
    shadow.querySelector('textarea')!.focus();
    expect(document.activeElement).toBe(host); // what the page sees of a focus in a closed shadow root
    expect(focused()).toEqual({ ok: false, problem: 'in-frame' });
    host.remove();
  });
});

describe('wheelAt', () => {
  it('the viewport', () => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 800 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 600 });
    expect(wheelAt(undefined)).toEqual({ x: 400, y: 300, width: 800, height: 600 });
  });

  it('an element', () => {
    $('b').getBoundingClientRect = () => rect(100, 50, 200, 100);
    expect(wheelAt($('b'))).toEqual({ x: 200, y: 100, width: 200, height: 100 });
  });
});

describe('clearField', () => {
  it('empties a field and fires input', () => {
    const field = $('i') as HTMLInputElement;
    field.value = 'old';
    const events: string[] = [];
    field.addEventListener('input', () => events.push('input'));
    expect(clearField(field)).toBe('emptied');
    expect(field.value).toBe('');
    expect(events).toEqual(['input']);
    expect(document.activeElement).toBe(field);
  });

  it('selects an editable element, its nodes left to its editor', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="e" contenteditable="true"><p>old</p><p>text</p></div>');
    const editor = $('e') as HTMLElement;
    const nodes = [...editor.childNodes];
    const events: string[] = [];
    editor.addEventListener('input', () => events.push('input'));
    expect(clearField(editor)).toBe('selected');
    expect([...editor.childNodes]).toEqual(nodes);
    expect(editor.textContent).toBe('oldtext');
    expect(getSelection()!.toString()).toBe('oldtext');
    expect(document.activeElement).toBe(editor);
    expect(events).toEqual([]);
    editor.remove();
  });
});

describe('caretAtEnd', () => {
  it('puts the caret after an editable element\'s text, nothing selected', () => {
    document.body.insertAdjacentHTML('beforeend', '<div id="e" contenteditable="true"><p>old</p></div>');
    const editor = $('e') as HTMLElement;
    caretAtEnd(editor);
    expect(document.activeElement).toBe(editor);
    const selection = getSelection()!;
    expect(selection.isCollapsed).toBe(true);
    const before = document.createRange();
    before.selectNodeContents(editor);
    before.setEnd(selection.anchorNode!, selection.anchorOffset);
    expect(before.toString()).toBe('old');
    editor.remove();
  });

  it('and after a field\'s value', () => {
    const field = $('i') as HTMLInputElement;
    field.value = 'old';
    field.setSelectionRange(0, 0);
    caretAtEnd(field);
    expect(document.activeElement).toBe(field);
    expect([field.selectionStart, field.selectionEnd]).toEqual([3, 3]);
  });

  it('only focuses a field with no caret to set', () => {
    const field = $('i') as HTMLInputElement;
    field.type = 'email';
    field.value = 'a@example.com';
    caretAtEnd(field);
    expect(document.activeElement).toBe(field);
  });

  it('refuses what is not a text field', () => {
    expect(() => caretAtEnd($('b'))).toThrow('not a text field');
  });
});

describe('focusSpot', () => {
  const withoutFocus = () => vi.spyOn(document, 'hasFocus').mockReturnValue(false);
  afterEach(() => vi.restoreAllMocks());
  const placed = (el: Element) => {
    boxes(el, [rect(10, 20, 100, 40)]);
    document.elementFromPoint = () => el;
  };

  it('none when the page has the browser\'s focus', () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true);
    placed($('i'));
    expect(focusSpot($('i'))).toBeNull();
  });

  it('the middle of a text field when it does not', () => {
    withoutFocus();
    placed($('i'));
    expect(focusSpot($('i'))).toEqual({ x: 60, y: 40 });
  });

  it('with no element, the page\'s focused text field', () => {
    withoutFocus();
    placed($('i'));
    $('i').focus();
    expect(focusSpot(undefined)).toEqual({ x: 60, y: 40 });
  });

  it('none on what a press would act on, or with nothing focused', () => {
    withoutFocus();
    placed($('b'));
    expect(focusSpot($('b'))).toBeNull();
    (document.activeElement as HTMLElement | null)?.blur();
    expect(focusSpot(undefined)).toBeNull();
  });

  it('none on a field that something covers', () => {
    withoutFocus();
    boxes($('i'), [rect(10, 20, 100, 40)]);
    document.elementFromPoint = () => $('top');
    expect(focusSpot($('i'))).toBeNull();
  });
});

describe('fieldText', () => {
  it('a field\'s value, an editable element\'s text without what it only shows', () => {
    ($('i') as HTMLInputElement).value = 'typed';
    expect(fieldText($('i'))).toBe('typed');
    document.body.insertAdjacentHTML('beforeend', '<div id="e" contenteditable="true"><span contenteditable="false">Write a message</span><p>typed</p></div>');
    expect(fieldText($('e'))).toBe('typed');
    expect($('e').textContent).toBe('Write a messagetyped'); // the copy alone was touched
    $('e').remove();
  });

  it('refuses what is not a text field', () => {
    expect(() => fieldText($('b'))).toThrow('not a text field');
  });
});

describe('keysSeenCount', () => {
  it('counts real key presses only, from before anything else on the page', () => {
    const listen = vi.spyOn(window, 'addEventListener');
    expect(keysSeenCount()).toBe(0);
    const [type, listener, capture] = listen.mock.calls[0]!;
    expect([type, capture]).toEqual(['keydown', true]);
    const press = (isTrusted: boolean) => (listener as (e: unknown) => void)({ isTrusted });
    press(false);
    expect(keysSeenCount()).toBe(0);
    press(true);
    expect(keysSeenCount()).toBe(1);
    expect(listen).toHaveBeenCalledOnce(); // one listener, however many calls
    listen.mockRestore();
  });
});

describe('inputStart / inputEnd', () => {
  const widget = () => {
    const host = document.createElement('ba-widget');
    host.style.setProperty('visibility', 'visible', 'important');
    document.documentElement.append(host);
    return host;
  };

  it('lets the pointer through our widget until the input ends, and says whether the tab is shown', () => {
    const host = widget();
    const { token, hidden } = inputStart();
    expect(hidden).toBe(false);
    expect(host.style.getPropertyValue('pointer-events')).toBe('none');
    expect(host.style.getPropertyPriority('pointer-events')).toBe('important');
    inputEnd(token);
    expect(host.style.getPropertyValue('pointer-events')).toBe('');
    expect(host.style.getPropertyValue('visibility')).toBe('visible');
    host.remove();
  });

  it('puts it back only once the last of two inputs ends', () => {
    const host = widget();
    const a = inputStart();
    const b = inputStart();
    inputEnd(a.token);
    expect(host.style.getPropertyValue('pointer-events')).toBe('none');
    inputEnd(b.token);
    expect(host.style.getPropertyValue('pointer-events')).toBe('');
    host.remove();
  });

  it('puts it back on its own when the end never comes', () => {
    vi.useFakeTimers();
    const host = widget();
    inputStart();
    vi.advanceTimersByTime(30_000);
    expect(host.style.getPropertyValue('pointer-events')).toBe('');
    vi.useRealTimers();
    host.remove();
  });

  it('says when the tab is not shown', () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    const { token, hidden } = inputStart();
    inputEnd(token);
    expect(hidden).toBe(true);
    delete (document as { visibilityState?: unknown }).visibilityState;
  });
});
