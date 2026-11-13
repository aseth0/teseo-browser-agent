// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { click, pressKey, selectOption, typeText, waitForSettle } from '../src/content/actions';

const $ = <T extends Element>(sel: string) => document.querySelector<T>(sel)!;

beforeEach(() => {
  document.body.innerHTML = `
    <form id="f"><input id="q" value="old" /><button>Go</button></form>
    <textarea id="t"></textarea>
    <div id="ce" contenteditable="true">draft</div>
    <select id="s"><option value="b">Black</option><option value="w" selected>White</option></select>
    <button id="off" disabled>Off</button>
    <input id="ro" readonly value="x" />`;
});

describe('click', () => {
  it('dispatches the pointer/mouse sequence and a click', () => {
    const seen: string[] = [];
    const btn = $('button');
    for (const t of ['pointerdown', 'mousedown', 'mouseup', 'click']) btn.addEventListener(t, () => seen.push(t));
    click(btn);
    expect(seen).toEqual(['pointerdown', 'mousedown', 'mouseup', 'click']);
  });

  it('refuses disabled elements', () => {
    expect(() => click($('#off'))).toThrow('disabled');
  });

  it('refuses an element inside a disabled fieldset', () => {
    document.body.innerHTML = '<fieldset disabled><legend><button id="in-legend">L</button></legend><button id="b">Pay</button></fieldset>';
    expect(() => click($('#b'))).toThrow('disabled');
    expect(() => click($('#in-legend'))).not.toThrow();
  });

  it('comes over the element first, with what a real mouse carries', () => {
    const btn = $('button');
    const seen: string[] = [];
    let down: PointerEvent | undefined;
    for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove', 'pointerdown', 'pointerup'])
      btn.addEventListener(t, (e) => {
        seen.push(t);
        if (t === 'pointerdown') down = e as PointerEvent;
      });
    click(btn);
    expect(seen).toEqual(['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'pointermove', 'mousemove', 'pointerdown', 'pointerup']);
    expect(down).toMatchObject({ button: 0, buttons: 1 });
  });

  it('focuses what takes focus around the element, or takes the focus away', () => {
    document.body.innerHTML = '<input id="q"><button id="b"><span id="in">Go</span></button><div id="plain">text</div>';
    $<HTMLInputElement>('#q').focus();
    click($('#in'));
    expect(document.activeElement).toBe($('#b'));
    $<HTMLInputElement>('#q').focus();
    click($('#plain'));
    expect(document.activeElement).toBe(document.body);
  });

  it('keeps the focus where it was when the page cancels the press', () => {
    document.body.innerHTML = '<input id="q"><div id="opt" tabindex="-1">Option</div>';
    $('#opt').addEventListener('mousedown', (e) => e.preventDefault());
    $<HTMLInputElement>('#q').focus();
    click($('#opt'));
    expect(document.activeElement).toBe($('#q'));
  });

  it('sends no mousedown or mouseup after a canceled pointerdown, and still clicks', () => {
    const btn = $('button');
    const seen: string[] = [];
    btn.addEventListener('pointerdown', (e) => e.preventDefault());
    for (const t of ['mousedown', 'mouseup', 'click']) btn.addEventListener(t, () => seen.push(t));
    click(btn);
    expect(seen).toEqual(['click']);
  });

  it('says what else is on top of the element at its center', () => {
    document.body.innerHTML = '<button id="b">Buy</button><div role="dialog" aria-label="Cookies"><p id="p">We use cookies</p></div><label>Agree <input id="c" type="checkbox"></label>';
    const at = (...els: Element[]) => {
      document.elementsFromPoint = () => els;
      document.elementFromPoint = () => els[0] ?? null;
    };
    try {
      at($('#p'), $('[role=dialog]'), document.body, document.documentElement);
      expect(click($('#b'))).toEqual({ covered: 'dialog "Cookies"' });
      at($('#b'), document.body, document.documentElement);
      expect(click($('#b'))).toEqual({});
      at($('label'), document.body, document.documentElement); // the checkbox's own label
      expect(click($('#c'))).toEqual({});
      const host = document.body.appendChild(document.createElement('div'));
      const shadow = host.attachShadow({ mode: 'open' });
      const inner = shadow.appendChild(document.createElement('button'));
      Object.assign(shadow, { elementsFromPoint: () => [], elementFromPoint: () => null }); // nothing found inside
      at(host, document.body, document.documentElement); // what holds it, across its shadow root
      expect(click(inner)).toEqual({});
    } finally {
      // @ts-expect-error jsdom has none of its own
      delete document.elementsFromPoint;
      // @ts-expect-error as above
      delete document.elementFromPoint;
    }
  });
});

describe('typeText', () => {
  it('replaces the value through the native setter and fires input/change', () => {
    const input = $<HTMLInputElement>('#q');
    // React-style value tracking: an own-property setter that records writes.
    let tracked = input.value;
    Object.defineProperty(input, 'value', { configurable: true, get: () => tracked, set: (v) => (tracked = `tracked:${v}`) });
    const events: string[] = [];
    input.addEventListener('input', () => events.push('input'));
    input.addEventListener('change', () => events.push('change'));
    typeText(input, 'headphones');
    expect(events).toEqual(['input', 'change']);
    // The prototype setter bypasses the tracker, which is what lets React see a change.
    expect(tracked).toBe('old');
    delete (input as { value?: unknown }).value;
    expect(input.value).toBe('headphones');
  });

  it('appends when clear=false, and edits textareas and contenteditable', async () => {
    await typeText($('#q'), '!', { clear: false });
    expect($<HTMLInputElement>('#q').value).toBe('old!');
    await typeText($('#t'), 'note');
    expect($<HTMLTextAreaElement>('#t').value).toBe('note');
    await typeText($('#ce'), 'hello');
    expect($('#ce').textContent).toBe('hello');
  });

  it('submits the form with submit=true', async () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    $('#f').addEventListener('submit', onSubmit);
    await typeText($('#q'), 'x', { submit: true });
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('presses Enter only once an editor with its own state has taken the text in', async () => {
    // As ProseMirror or a framework's composer: its state follows the input a task later, and Enter
    // sends what the state holds.
    const editor = $('#ce');
    let state = '';
    const sent: string[] = [];
    editor.addEventListener('input', () => setTimeout(() => (state = editor.textContent ?? ''), 0));
    editor.addEventListener('keydown', (e) => {
      if ((e as KeyboardEvent).key === 'Enter' && state) sent.push(state);
    });
    await typeText(editor, 'hello', { submit: true });
    expect(sent).toEqual(['hello']);
  });

  describe('in an editor that keeps its own model', () => {
    // As Slate or Lexical: the model follows the selection and beforeinput, the DOM is drawn from it, and
    // an edit over nodes it did not draw is lost. Enter sends what the model holds.
    function modelEditor(text: string) {
      const editor = $<HTMLElement>('#ce');
      const state = { text, sent: [] as string[], edits: [] as string[] };
      const draw = () => {
        editor.innerHTML = '<p><span data-leaf></span></p>';
        editor.querySelector('[data-leaf]')!.textContent = state.text;
      };
      draw();
      editor.addEventListener('beforeinput', (event) => {
        const e = event as InputEvent;
        e.preventDefault();
        const range = getSelection()!.getRangeAt(0);
        if (!editor.querySelector('[data-leaf]') || !editor.contains(range.startContainer)) return;
        const before = document.createRange();
        before.selectNodeContents(editor);
        before.setEnd(range.startContainer, range.startOffset);
        const start = before.toString().length;
        state.text = state.text.slice(0, start) + (e.data ?? '') + state.text.slice(start + range.toString().length);
        state.edits.push(e.inputType);
        draw();
      });
      editor.addEventListener('keydown', (e) => {
        if ((e as KeyboardEvent).key === 'Enter') state.sent.push(state.text);
      });
      return state;
    }

    it('replaces the text with one edit over the selection, so Enter sends it', async () => {
      const state = modelEditor('old draft');
      await typeText($('#ce'), 'hello', { submit: true });
      expect(state.text).toBe('hello');
      expect(state.edits).toEqual(['insertText']);
      expect(state.sent).toEqual(['hello']);
      expect($('#ce').textContent).toBe('hello');
    });

    it('edits only once the selection has been taken in, as a selectionchange comes later', async () => {
      const state = modelEditor('old draft');
      let taken = '';
      document.addEventListener('selectionchange', () => (taken = getSelection()!.toString()), { once: true });
      const editor = $('#ce');
      let atEdit: string | undefined;
      editor.addEventListener('beforeinput', () => (atEdit = taken), { capture: true });
      const typing = typeText(editor, 'hello');
      expect(state.text).toBe('old draft'); // not yet, on this task
      await typing;
      expect(state.text).toBe('hello');
      expect(atEdit).toBe('old draft');
    });

    it('appends at the end with clear=false', async () => {
      const state = modelEditor('old draft');
      await typeText($('#ce'), ' more', { clear: false });
      expect(state.text).toBe('old draft more');
    });

    it('deletes the text when there is none to type', async () => {
      const state = modelEditor('old draft');
      await typeText($('#ce'), '');
      expect(state.text).toBe('');
      expect(state.edits).toEqual(['deleteContentBackward']);
    });

    it('changes nothing with no text and clear=false', async () => {
      const state = modelEditor('old draft');
      await typeText($('#ce'), '', { clear: false });
      expect(state.text).toBe('old draft');
      expect(state.edits).toEqual([]);
    });
  });

  describe('in a plain editable element', () => {
    // execCommand, which jsdom lacks: what the browser does over the selection.
    function withExecCommand(run: () => boolean) {
      const exec = vi.fn((..._args: unknown[]) => run());
      Object.defineProperty(document, 'execCommand', { configurable: true, value: exec });
      return exec;
    }
    afterEach(() => {
      delete (document as { execCommand?: unknown }).execCommand;
    });

    it('leaves the edit to execCommand when no editor takes the beforeinput, the old text still there', async () => {
      const seen: string[] = [];
      const exec = withExecCommand(() => {
        seen.push(getSelection()!.toString());
        return true;
      });
      const inputs = vi.fn();
      $('#ce').addEventListener('input', inputs);
      await typeText($('#ce'), 'hello');
      expect(exec).toHaveBeenCalledExactlyOnceWith('insertText', false, 'hello');
      expect(seen).toEqual(['draft']); // selected, not removed
      expect($('#ce').textContent).toBe('draft');
      expect(inputs).not.toHaveBeenCalled(); // the browser's own, with the edit
    });

    it('runs execCommand only when the beforeinput is not canceled', async () => {
      const exec = withExecCommand(() => true);
      $('#ce').addEventListener('beforeinput', (e) => e.preventDefault());
      await typeText($('#ce'), 'hello');
      expect(exec).not.toHaveBeenCalled();
    });

    it('deletes with execCommand when there is no text to type', async () => {
      const exec = withExecCommand(() => true);
      await typeText($('#ce'), '');
      expect(exec).toHaveBeenCalledExactlyOnceWith('delete');
    });

    it('still sets the text when execCommand does nothing', async () => {
      withExecCommand(() => false);
      const inputs = vi.fn();
      $('#ce').addEventListener('input', inputs);
      await typeText($('#ce'), 'hello');
      expect($('#ce').textContent).toBe('hello');
      expect(inputs).toHaveBeenCalledOnce();
      await typeText($('#ce'), ' more', { clear: false });
      expect($('#ce').textContent).toBe('hello more');
      await typeText($('#ce'), '');
      expect($('#ce').textContent).toBe('');
    });
  });

  it('checks the value of inputs that are not typed into, as Playwright fill does', async () => {
    document.body.innerHTML = '<input id="d" type="date" value="2026-01-02"><input id="n" type="number"><input id="c" type="checkbox"><input id="r" type="range" min="0" max="10">';
    await expect(typeText($('#d'), '06/11/2026')).rejects.toThrow('takes yyyy-mm-dd, not "06/11/2026"');
    expect($<HTMLInputElement>('#d').value).toBe('2026-01-02');
    await typeText($('#d'), ' 2026-11-06 ');
    expect($<HTMLInputElement>('#d').value).toBe('2026-11-06');
    await expect(typeText($('#n'), 'twelve')).rejects.toThrow('Cannot type text into input[type=number]');
    await expect(typeText($('#c'), 'yes')).rejects.toThrow('click it instead');
    await expect(typeText($('#r'), '42')).rejects.toThrow('a number from 0 to 10');
  });

  it('rejects read-only fields and non-text elements', async () => {
    await expect(typeText($('#ro'), 'y')).rejects.toThrow('read-only');
    await expect(typeText($('button'), 'y')).rejects.toThrow('not a text field');
  });
});

describe('selectOption', () => {
  it('selects by visible text or value and reports the label', () => {
    const select = $<HTMLSelectElement>('#s');
    const onChange = vi.fn();
    select.addEventListener('change', onChange);
    expect(selectOption(select, 'black')).toBe('Black');
    expect(select.value).toBe('b');
    expect(selectOption(select, 'w')).toBe('White');
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('selects by visible text whatever its accents', () => {
    document.body.innerHTML = '<select id="c"><option value="es">España</option><option value="fr">France</option></select>';
    expect(selectOption($('#c'), 'espana')).toBe('España');
    expect($<HTMLSelectElement>('#c').value).toBe('es');
  });

  it('refuses a disabled option', () => {
    document.body.innerHTML = '<select id="s"><option>Any</option><optgroup label="Sold out" disabled><option>Large</option></optgroup></select>';
    expect(() => selectOption($('#s'), 'Large')).toThrow('The option "Large" is disabled');
  });

  it('lists the available options when none matches', () => {
    expect(() => selectOption($('#s'), 'Red')).toThrow('Options: Black, White');
  });
});

describe('pressKey', () => {
  it('lets the page cancel Enter before it submits', () => {
    const onSubmit = vi.fn((e: Event) => e.preventDefault());
    $('#f').addEventListener('submit', onSubmit);
    $('#q').addEventListener('keydown', (e) => e.preventDefault());
    pressKey($('#q'), 'Enter');
    expect(onSubmit).not.toHaveBeenCalled();
  });

  const keydowns = (el: Element) => {
    const seen: { key: string; code: string; keyCode: number; which: number }[] = [];
    el.addEventListener('keydown', (e) => seen.push({ key: (e as KeyboardEvent).key, code: (e as KeyboardEvent).code, keyCode: (e as KeyboardEvent).keyCode, which: (e as KeyboardEvent).which }));
    return seen;
  };

  it('carries the key, code and keyCode a real key has, for pages that read keyCode', () => {
    const seen = keydowns($('#q'));
    for (const key of ['Enter', 'Escape', 'Space', 'ArrowDown', 'a', 'Z', '7']) pressKey($('#q'), key);
    expect(seen).toEqual([
      { key: 'Enter', code: 'Enter', keyCode: 13, which: 13 },
      { key: 'Escape', code: 'Escape', keyCode: 27, which: 27 },
      { key: ' ', code: 'Space', keyCode: 32, which: 32 },
      { key: 'ArrowDown', code: 'ArrowDown', keyCode: 40, which: 40 },
      { key: 'a', code: 'KeyA', keyCode: 65, which: 65 },
      { key: 'Z', code: 'KeyZ', keyCode: 90, which: 90 },
      { key: '7', code: 'Digit7', keyCode: 55, which: 55 },
    ]);
  });

  it('fires keypress only for a key that types', () => {
    const presses: string[] = [];
    $('#q').addEventListener('keypress', (e) => presses.push((e as KeyboardEvent).key));
    for (const key of ['Enter', 'Escape', 'ArrowDown', 'Tab', 'a']) pressKey($('#q'), key);
    expect(presses).toEqual(['Enter', 'a']);
  });

  it('focuses the element it presses on', () => {
    pressKey($('#t'), 'Escape');
    expect(document.activeElement).toBe($('#t'));
  });

  it('clicks a button or a link on Enter, and a button, checkbox or role=button on Space', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="b" type="button">B</button><a id="l" href="#x">L</a><input id="c" type="checkbox" /><div id="r" role="button" tabindex="0">R</div>');
    const clicks: string[] = [];
    for (const id of ['b', 'l', 'c', 'r']) $(`#${id}`).addEventListener('click', () => clicks.push(id));
    pressKey($('#b'), 'Enter');
    pressKey($('#l'), 'Enter');
    pressKey($('#r'), 'Enter');
    pressKey($('#b'), 'Space');
    pressKey($('#c'), 'Space');
    pressKey($('#r'), 'Space');
    expect(clicks).toEqual(['b', 'l', 'r', 'b', 'c', 'r']);
    expect($<HTMLInputElement>('#c').checked).toBe(true);
  });

  it('does not click when the page cancels the key', () => {
    document.body.insertAdjacentHTML('beforeend', '<button id="b" type="button">B</button>');
    const onClick = vi.fn();
    $('#b').addEventListener('click', onClick);
    $('#b').addEventListener('keydown', (e) => e.preventDefault());
    pressKey($('#b'), 'Enter');
    $('#b').addEventListener('keyup', (e) => e.preventDefault());
    pressKey($('#b'), 'Space');
    expect(onClick).not.toHaveBeenCalled();
  });

  it('moves the choice of a <select> with the arrows, Home and End, firing input and change', () => {
    const s = $<HTMLSelectElement>('#s');
    s.insertAdjacentHTML('beforeend', '<option value="r">Red</option>');
    const changes = vi.fn();
    s.addEventListener('change', changes);
    pressKey(s, 'ArrowDown');
    expect(s.value).toBe('r');
    pressKey(s, 'ArrowDown'); // at the end already: no change
    pressKey(s, 'Home');
    expect(s.value).toBe('b');
    pressKey(s, 'ArrowUp');
    pressKey(s, 'End');
    expect(s.value).toBe('r');
    expect(changes).toHaveBeenCalledTimes(3);
  });

  it('moves the focus to the next element on Tab', () => {
    document.body.innerHTML = '<input id="a" /><span>x</span><button id="hidden" hidden>h</button><button id="off" disabled>o</button><a id="b" href="#">b</a><div id="c" tabindex="0">c</div><div tabindex="-1">no</div>';
    pressKey($('#a'), 'Tab');
    expect(document.activeElement).toBe($('#b'));
    pressKey(document.activeElement!, 'Tab');
    expect(document.activeElement).toBe($('#c'));
  });
});

describe('waitForSettle', () => {
  it('waits until the DOM is quiet', async () => {
    const start = Date.now();
    setTimeout(() => document.body.append('a'), 30);
    setTimeout(() => document.body.append('b'), 60);
    await waitForSettle(document, 50, 1000);
    expect(Date.now() - start).toBeGreaterThanOrEqual(100);
    expect(document.body.textContent).toContain('ab');
  });
});
