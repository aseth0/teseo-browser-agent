import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Tool, ToolContext } from '../src/core/types';

// The debugger: a session that records what is sent. `blockOn`: a method during which the page opens
// the dialog `dialog` (the input then never returns, as with a real dialog).
const sent: { method: string; params?: Record<string, unknown> }[] = [];
let blockOn: string | undefined;
let permitted = true;
let engineOn = true;
let current: { event: string; l: Listener }[] = []; // the running fake session's listeners
const emit = (event: string, p: Record<string, unknown>) => current.filter((x) => x.event === event).forEach((x) => x.l(p));
type Listener = (p: Record<string, unknown>) => void;
const withDebugger = vi.fn(async (_tabId: number, fn: (s: { send: (m: string, p?: Record<string, unknown>) => Promise<unknown>; on: (e: string, l: Listener) => void }) => Promise<unknown>) => {
  const listeners: { event: string; l: Listener }[] = [];
  current = listeners;
  return fn({
    send: async (method, params) => {
      sent.push({ method, params });
      if (method === blockOn && params?.type !== 'mouseMoved' && params?.type !== 'keyUp') return new Promise(() => undefined);
      return method === 'Page.captureScreenshot' ? { data: 'SHOT' } : {};
    },
    on: (event, l) => void listeners.push({ event, l }),
  });
});
vi.mock('../src/devtools/cdp', () => ({
  withDebugger,
  requireEngine: async () => {
    if (!engineOn) throw new Error('Chromium DevTools tools are off: turn them on in Settings → Chromium DevTools.');
  },
}));

// The page: answers by op.
let pageAnswers: Record<string, unknown> = {};
let answers = 0; // by default, each look at the page finds what real input sent has arrived
const pageCalls: { op: string; [k: string]: unknown }[] = [];
const guardCalls: { op: string; [k: string]: unknown }[] = []; // the widget's guard around each engine input, apart
const GUARD = new Set(['input-start', 'input-end']);
const changeCalls: { op: string; [k: string]: unknown }[] = []; // a click's watch on what it changes, apart (content/change)
const CHANGE = new Set(['change-start', 'change-end']);
vi.mock('../src/page/bridge', () => ({
  callPage: vi.fn(async (_tabId: number, req: { op: string }) => {
    (GUARD.has(req.op) ? guardCalls : CHANGE.has(req.op) ? changeCalls : pageCalls).push(req);
    if (!(req.op in pageAnswers)) throw new Error(`unexpected op ${req.op}`);
    const answer = pageAnswers[req.op];
    return typeof answer === 'function' ? (answer as (r: unknown) => unknown)(req) : answer;
  }),
  waitForLoad: async () => undefined,
  actOnPage: vi.fn(async () => 'done'),
}));
vi.mock('../src/core/image', () => ({ shrinkImage: async (_b: Blob, _side: number, o: { keep: unknown }) => o.keep, blobOf: () => new Blob() }));

let tabUrl = 'https://shop.example.test/cart';
let tabInfo: Record<string, unknown> = {};
const created = new Set<(tab: { openerTabId?: number }) => void>(); // tabs.onCreated's listeners
vi.mock('wxt/browser', () => ({
  browser: {
    tabs: { get: async (id: number) => ({ id, url: tabUrl, active: false, windowId: 1, ...tabInfo }), onCreated: { addListener: (l: never) => created.add(l), removeListener: (l: never) => created.delete(l) } },
    permissions: { contains: async () => permitted },
    debugger: {},
  },
}));
vi.mock('../src/core/util', async (orig) => ({ ...(await orig<object>()), sleep: async () => undefined }));

const { engineTools, engineToolsFor } = await import('../src/tools/browser/engine-tools');
const { KEYS, modifierMask } = await import('../src/tools/browser/keys');
const { textLanded } = await import('../src/tools/browser/engine');
const bridge = await import('../src/page/bridge');

const ctx = (extra: Partial<ToolContext> = {}): ToolContext => ({ tabId: 5, signal: new AbortController().signal, settings: { devtoolsTools: true } as ToolContext['settings'], approvedHost: 'shop.example.test', ...extra });
const tool = (name: string): Tool => engineTools().find((t) => t.name === name)!;
const methods = () => sent.map((s) => s.method);
const afterAction = { settle: null, context: { meta: { url: 'https://shop.example.test/cart', title: 'Cart' }, snapshot: { text: 'button "OK" [ref_1]', truncated: false }, selection: { text: '', truncated: false } } };

beforeEach(() => {
  sent.length = 0;
  pageCalls.length = 0;
  guardCalls.length = 0;
  changeCalls.length = 0;
  withDebugger.mockClear();
  blockOn = undefined;
  permitted = true;
  engineOn = true;
  tabUrl = 'https://shop.example.test/cart';
  tabInfo = {};
  pageAnswers = { ...afterAction, 'input-start': { token: 'g1', hidden: false }, 'input-end': null, locate: { ok: true, x: 60, y: 20, box: { x: 10, y: 10, width: 100, height: 20 } }, describe: 'button "OK"', 'change-start': 'w1', 'change-end': true, focused: { ok: true }, clear: 'selected', 'caret-end': null, 'focus-spot': null, 'field-text': () => `held ${++answers}`, 'keys-seen': () => ++answers, 'wheel-point': { x: 400, y: 300, width: 800, height: 600 } };
});

describe('keys', () => {
  it('Tab is code Tab, vk 9', () => expect(KEYS.Tab).toEqual({ code: 'Tab', vk: 9 }));
  it('modifiers add up', () => expect(modifierMask(['Shift', 'Control'])).toBe(10));
});

describe('browser.click', () => {
  it('sends moved, pressed, released at the located point', async () => {
    const result = await tool('browser.click').run({ ref: 'ref_1' }, ctx());
    expect(methods()).toEqual(['Input.dispatchMouseEvent', 'Input.dispatchMouseEvent', 'Input.dispatchMouseEvent']);
    expect(sent.map((s) => s.params?.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
    expect(sent[1]!.params).toMatchObject({ x: 60, y: 20, button: 'left', clickCount: 1 });
    expect(pageCalls[0]).toEqual({ op: 'locate', ref: 'ref_1', focus: false, host: 'shop.example.test' });
    expect(result.type).toBe('text');
  });

  it('watches what the click changes from after the move to before the press, and says when it changed nothing', async () => {
    pageAnswers['change-end'] = false;
    pageAnswers['change-start'] = () => {
      expect(sent.map((x) => x.params?.type)).toEqual(['mouseMoved']);
      return 'w1';
    };
    const result = await tool('browser.click').run({ ref: 'ref_1' }, ctx());
    expect(changeCalls).toEqual([{ op: 'change-start', ref: 'ref_1' }, { op: 'change-end', token: 'w1' }]);
    expect((result as { text: string }).text).toMatch(/^clicked, but nothing changed: same URL/);
    expect(created.size).toBe(0);
  });

  it('a tab opened from it is a change', async () => {
    pageAnswers['change-end'] = false;
    pageAnswers.settle = () => {
      for (const l of created) l({ openerTabId: 5 });
      return null;
    };
    const result = await tool('browser.click').run({ ref: 'ref_1' }, ctx());
    expect((result as { text: string }).text).toMatch(/^clicked\.\n/);
  });

  it('throws the covered text and never attaches', async () => {
    pageAnswers.locate = { ok: false, problem: 'covered', other: 'div "Cookies"' };
    await expect(tool('browser.click').run({ ref: 'ref_1' }, ctx())).rejects.toThrow('The element is covered by div "Cookies" at its center: not clicked');
    expect(withDebugger).not.toHaveBeenCalled();
  });

  it('stops when the host changed before the click', async () => {
    tabUrl = 'https://other.example.test/';
    await expect(tool('browser.click').run({ ref: 'ref_1' }, ctx())).rejects.toThrow(/Not done: the tab is now on other\.example\.test/);
    expect(sent.filter((x) => x.method.startsWith('Input.'))).toEqual([]);
  });

  it('is a write tool of the browser source, described as real input', async () => {
    const t = tool('browser.click');
    expect(t.source).toBe('browser');
    expect(t.effect).toBe('write');
    expect((await t.describe!({ ref: 'ref_1' }, ctx())).summary).toBe('Click button "OK" (real input)');
  });
});

describe('browser.press_key', () => {
  it('focuses the ref, turns on focus emulation, sends rawKeyDown and keyUp', async () => {
    await tool('browser.press_key').run({ key: 'Tab', ref: 'ref_1', modifiers: ['Shift'] }, ctx());
    expect(pageCalls[0]).toMatchObject({ op: 'locate', ref: 'ref_1', focus: true });
    expect(methods()).toEqual(['Emulation.setFocusEmulationEnabled', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent']);
    expect(sent[1]!.params).toEqual({ type: 'rawKeyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
    expect(sent[2]!.params).toEqual({ type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9, modifiers: 8 });
  });

  it('Enter carries its text, on the focused element when no ref', async () => {
    pageAnswers.focused = { ok: true };
    await tool('browser.press_key').run({ key: 'Enter' }, ctx());
    expect(pageCalls[0]).toEqual({ op: 'focused', host: 'shop.example.test' });
    expect(sent[1]!.params).toMatchObject({ type: 'keyDown', key: 'Enter', text: '\r' });
  });

  it('without a ref goes through the page first, so a site without access is never attached', async () => {
    pageAnswers.focused = () => Promise.reject(new Error('No permission to read the tab'));
    await expect(tool('browser.press_key').run({ key: 'Enter' }, ctx())).rejects.toThrow('No permission to read the tab');
    expect(withDebugger).not.toHaveBeenCalled();
  });

  it('refuses the focus inside a frame', async () => {
    pageAnswers.focused = { ok: false, problem: 'in-frame' };
    await expect(tool('browser.press_key').run({ key: 'Enter' }, ctx())).rejects.toThrow('The element is inside a frame, which real input cannot reach yet');
    expect(withDebugger).not.toHaveBeenCalled();
  });

  it('refuses a name of the key table\'s prototype', async () => {
    await expect(tool('browser.press_key').run({ key: 'constructor' }, ctx())).rejects.toThrow(/^This key cannot be pressed with real input: use one of Enter, Tab/);
    expect(withDebugger).not.toHaveBeenCalled();
  });

  it('refuses a key outside the list', async () => {
    await expect(tool('browser.press_key').run({ key: 'F12' }, ctx())).rejects.toThrow('This key cannot be pressed with real input: use one of Enter, Tab, Escape, Backspace, Delete, Space, ArrowUp, ArrowDown, ArrowLeft, ArrowRight, Home, End, PageUp, PageDown, or a single character');
    expect(withDebugger).not.toHaveBeenCalled();
  });
});

describe('browser.press_key sees the key arrive', () => {
  it('fails when the page saw no key press', async () => {
    pageAnswers['keys-seen'] = 3;
    await expect(tool('browser.press_key').run({ key: 'Enter', ref: 'ref_1' }, ctx())).rejects.toThrow('The key did not reach the page');
  });

  it('takes a key that took the page away as seen', async () => {
    let looks = 0;
    pageAnswers['keys-seen'] = () => {
      if (++looks > 1) throw new Error('The tab did not answer');
      return 3;
    };
    await tool('browser.press_key').run({ key: 'Enter', ref: 'ref_1' }, ctx());
    expect(looks).toBe(2);
  });

  it('a new page, its count from zero, has seen it too', async () => {
    let looks = 0;
    pageAnswers['keys-seen'] = () => (++looks > 1 ? 0 : 3);
    await tool('browser.press_key').run({ key: 'Enter', ref: 'ref_1' }, ctx());
  });
});

describe('browser.type', () => {
  it('clears, inserts and submits with a real Enter', async () => {
    await tool('browser.type').run({ ref: 'ref_1', text: 'hello', submit: true }, ctx());
    // Located first, a field that real input cannot reach left as it was; not focused there, as the
    // clear does it in one go with the selection.
    expect(pageCalls.slice(0, 3)).toEqual([{ op: 'locate', ref: 'ref_1', focus: false, host: 'shop.example.test' }, { op: 'focus-spot', ref: 'ref_1', host: 'shop.example.test' }, { op: 'clear', ref: 'ref_1', host: 'shop.example.test' }]);
    expect(methods()).toEqual(['Emulation.setFocusEmulationEnabled', 'Input.insertText', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent']);
    expect(sent[1]!.params).toEqual({ text: 'hello' });
    expect(sent[2]!.params).toMatchObject({ type: 'keyDown', key: 'Enter', text: '\r' });
  });

  it('lets the page settle between the text and Enter', async () => {
    pageAnswers.settle = () => {
      sent.push({ method: 'settle' });
      return null;
    };
    await tool('browser.type').run({ ref: 'ref_1', text: 'hello', submit: true }, ctx());
    expect(methods().slice(0, 5)).toEqual(['Emulation.setFocusEmulationEnabled', 'settle', 'Input.insertText', 'settle', 'Input.dispatchKeyEvent']);
  });

  it('with clear=false does not clear: the caret goes to the end', async () => {
    await tool('browser.type').run({ ref: 'ref_1', text: 'hello', clear: false }, ctx());
    expect(pageCalls.some((c) => c.op === 'clear')).toBe(false);
    expect(pageCalls).toContainEqual({ op: 'caret-end', ref: 'ref_1', host: 'shop.example.test' });
    expect(sent.find((c) => c.method === 'Input.insertText')!.params).toEqual({ text: 'hello' });
  });

  // The page's steps among what is sent, to see their order.
  const seeInOrder = (op: string, answer: unknown) => {
    pageAnswers[op] = () => {
      sent.push({ method: op });
      return answer;
    };
  };

  it('selects the field with focus emulated, and lets the page take that in before the text', async () => {
    seeInOrder('clear', 'selected');
    seeInOrder('settle', null);
    await tool('browser.type').run({ ref: 'ref_1', text: 'hello' }, ctx());
    expect(methods().slice(0, 4)).toEqual(['Emulation.setFocusEmulationEnabled', 'clear', 'settle', 'Input.insertText']);
  });

  it('with no text deletes the selected contents with a real Backspace, once the page has taken them in', async () => {
    seeInOrder('settle', null);
    await tool('browser.type').run({ ref: 'ref_1', text: '' }, ctx());
    expect(methods().slice(0, 4)).toEqual(['Emulation.setFocusEmulationEnabled', 'settle', 'Input.dispatchKeyEvent', 'Input.dispatchKeyEvent']);
    expect(sent[2]!.params).toMatchObject({ type: 'rawKeyDown', key: 'Backspace' });
  });

  it('does not wait on a field emptied, or for a caret at the end', async () => {
    seeInOrder('settle', null);
    pageAnswers.clear = 'emptied';
    for (const args of [{}, { clear: false }]) {
      sent.length = 0;
      await tool('browser.type').run({ ref: 'ref_1', text: 'hello', ...args }, ctx());
      expect(methods().slice(0, 2)).toEqual(['Emulation.setFocusEmulationEnabled', 'Input.insertText']);
    }
  });

  it('with no text presses nothing on a field already emptied, or with clear=false', async () => {
    pageAnswers.clear = 'emptied';
    await tool('browser.type').run({ ref: 'ref_1', text: '' }, ctx());
    await tool('browser.type').run({ ref: 'ref_1', text: '', clear: false }, ctx());
    expect(methods()).toEqual(['Emulation.setFocusEmulationEnabled', 'Emulation.setFocusEmulationEnabled']);
  });

  describe('without the browser\'s focus on the page', () => {
    const SPOT = { x: 60, y: 20 };
    const mouseEvents = () => sent.filter((c) => c.method === 'Input.dispatchMouseEvent').map((c) => (c.params as { type: string }).type);

    it('presses on the field first, before focus emulation and the selection', async () => {
      pageAnswers['focus-spot'] = SPOT;
      seeInOrder('clear', 'selected');
      await tool('browser.type').run({ ref: 'ref_1', text: 'hello' }, ctx());
      expect(mouseEvents()).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
      expect(methods().slice(3, 5)).toEqual(['Emulation.setFocusEmulationEnabled', 'clear']);
      expect(sent[1]!.params).toMatchObject({ type: 'mousePressed', ...SPOT });
    });

    it('lets an editor take in the caret of that press before selecting', async () => {
      pageAnswers['focus-spot'] = SPOT;
      await tool('browser.type').run({ ref: 'ref_1', text: 'hello' }, ctx());
      const ops = pageCalls.map((c) => c.op);
      expect(ops.slice(ops.indexOf('focus-spot'), ops.indexOf('clear') + 1)).toEqual(['focus-spot', 'settle', 'clear']);
    });

    it('presses nothing when the page has it', async () => {
      await tool('browser.type').run({ ref: 'ref_1', text: 'hello' }, ctx());
      expect(mouseEvents()).toEqual([]);
    });

    it('does the same before a key, with or without a ref', async () => {
      pageAnswers['focus-spot'] = SPOT;
      await tool('browser.press_key').run({ key: 'Enter', ref: 'ref_1' }, ctx());
      expect(pageCalls).toContainEqual({ op: 'focus-spot', ref: 'ref_1', host: 'shop.example.test' });
      expect(mouseEvents()).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
      sent.length = 0;
      await tool('browser.press_key').run({ key: 'Enter' }, ctx());
      expect(pageCalls).toContainEqual({ op: 'focus-spot', host: 'shop.example.test' });
      expect(mouseEvents()).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
    });
  });

  describe('checks that the text arrived', () => {
    const NOT_THERE = 'The text did not reach the field';
    const enterSent = () => sent.some((c) => (c.params as { key?: string } | undefined)?.key === 'Enter');

    it('fails with no Enter when the field stays as it was', async () => {
      pageAnswers['field-text'] = 'old draft';
      await expect(tool('browser.type').run({ ref: 'ref_1', text: 'hello', submit: true }, ctx())).rejects.toThrow(NOT_THERE);
      expect(enterSent()).toBe(false);
    });

    it('looks again once the page has settled, for an editor that takes it in later', async () => {
      let looks = 0;
      pageAnswers['field-text'] = () => (++looks < 3 ? 'old draft' : 'hello');
      await tool('browser.type').run({ ref: 'ref_1', text: 'hello', submit: true }, ctx());
      expect(looks).toBe(3);
      expect(enterSent()).toBe(true);
    });

    it('takes a field gone from the page as changed by the text', async () => {
      let looks = 0;
      pageAnswers['field-text'] = () => {
        if (++looks > 1) throw new Error('No element with ref ref_1');
        return '';
      };
      await tool('browser.type').run({ ref: 'ref_1', text: 'hello' }, ctx());
      expect(looks).toBe(2);
    });

    it('fails when a delete changes nothing', async () => {
      pageAnswers['field-text'] = 'old draft';
      await expect(tool('browser.type').run({ ref: 'ref_1', text: '' }, ctx())).rejects.toThrow(NOT_THERE);
    });

    it('has nothing to check when nothing was sent', async () => {
      await tool('browser.type').run({ ref: 'ref_1', text: '', clear: false }, ctx());
      expect(pageCalls.some((c) => c.op === 'field-text')).toBe(false);
    });
  });

  describe('textLanded', () => {
    it.each([
      ['typed into an empty field', '', 'hello', 'hello', true, true],
      ['replaced', 'old', 'hello', 'hello', true, true],
      ['appended', 'old', 'old more', ' more', false, true],
      ['reformatted by a mask', '', '(555) 123-4567', '5551234567', true, true],
      ['cut by a length limit', '', 'hel', 'hello', true, true],
      ['the same text replaced', 'hello', 'hello', 'hello', true, true],
      ['deleted', 'old', '', '', true, true],
      ['deleted from an empty field', '', '', '', true, true],
      ['nothing in an empty field', '', '', 'hello', true, false],
      ['nothing in a field with other text', 'old', 'old', 'hello', true, false],
      ['nothing in a field holding it among more', 'say hello', 'say hello', 'hello', true, false],
      ['nothing added to the same text', 'hello', 'hello', 'hello', false, false],
      ['only an editor\'s zero-width character', '', '\uFEFF', 'hello', true, false],
      ['only an editor\'s line break', 'old', 'old\n', 'hello', true, false],
      ['typed with an editor\'s zero-width character', '', 'hello\u200B', 'hello', true, true],
    ])('%s', (_name, before, now, text, replace, landed) => {
      expect(textLanded(before, now, text, replace)).toBe(landed);
    });
  });

  it('shows the text like the synthetic one on its card', async () => {
    const card = await tool('browser.type').describe!({ ref: 'ref_1', text: 'hello' }, ctx());
    expect(card.details).toEqual([{ label: 'Text · 5 chars', value: 'hello', code: true }]);
  });
});

describe('browser.screenshot', () => {
  beforeEach(() => {
    pageAnswers.mask = (req: { selectors: string[] }) => ({ token: 't1', count: 2 + req.selectors.length });
    pageAnswers.unmask = true;
    pageAnswers.remask = 0;
  });

  it('masks, captures, unmasks and reports the count', async () => {
    const result = await tool('browser.screenshot').run({}, ctx({ settings: { devtoolsTools: true, devtoolsMask: 'example.test #card' } as ToolContext['settings'] }));
    expect(pageCalls.map((c) => c.op)).toEqual(['mask', 'unmask']);
    expect(pageCalls[0]).toEqual({ op: 'mask', selectors: ['#card'] });
    expect(sent[0]).toEqual({ method: 'Page.captureScreenshot', params: { format: 'jpeg', quality: 60 } });
    expect(result).toEqual({ type: 'image', mediaType: 'image/jpeg', data: 'SHOT', note: '3 sensitive fields were masked' });
  });

  it('refuses a discarded tab', async () => {
    tabInfo = { discarded: true };
    await expect(tool('browser.screenshot').run({}, ctx())).rejects.toThrow(/discarded/);
    expect(pageCalls).toEqual([]);
  });

  it('discards a capture when unmask finds no mask', async () => {
    pageAnswers.unmask = false;
    await expect(tool('browser.screenshot').run({}, ctx())).rejects.toThrow('The page changed during the capture: try again.');
  });

  it('captures one element by ref', async () => {
    await tool('browser.screenshot').run({ ref: 'ref_1' }, ctx());
    expect(pageCalls.map((c) => c.op)).toEqual(['mask', 'locate', 'unmask']);
    expect(sent.find((x) => x.method === 'Page.captureScreenshot')!.params).toEqual({ format: 'jpeg', quality: 60, clip: { x: 10, y: 10, width: 100, height: 20, scale: 1 } });
  });

  it('captures the whole page', async () => {
    await tool('browser.screenshot').run({ fullPage: true }, ctx());
    expect(sent.find((x) => x.method === 'Page.captureScreenshot')!.params).toEqual({ format: 'jpeg', quality: 60, captureBeyondViewport: true });
  });

  it('refuses ref with fullPage', async () => {
    await expect(tool('browser.screenshot').run({ ref: 'ref_1', fullPage: true }, ctx())).rejects.toThrow(/ref or fullPage/);
    expect(pageCalls).toEqual([]);
  });

  it('phone view set then cleared', async () => {
    await tool('browser.screenshot').run({ view: 'mobile' }, ctx());
    expect(methods()).toEqual(['Emulation.setDeviceMetricsOverride', 'Emulation.setTouchEmulationEnabled', 'Page.captureScreenshot', 'Emulation.clearDeviceMetricsOverride', 'Emulation.setTouchEmulationEnabled']);
    expect(sent[0]!.params).toEqual({ width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
  });

  it('dark view set then cleared', async () => {
    await tool('browser.screenshot').run({ view: 'dark' }, ctx());
    expect(sent.map((x) => [x.method, x.params])).toEqual([
      ['Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] }],
      ['Page.captureScreenshot', { format: 'jpeg', quality: 60 }],
      ['Emulation.setEmulatedMedia', { features: [] }],
    ]);
  });

  it('clears the view after a failed capture', async () => {
    blockOn = undefined;
    withDebugger.mockImplementationOnce(async (_t, fn) =>
      fn({
        send: async (method: string, params?: Record<string, unknown>) => {
          sent.push({ method, params });
          if (method === 'Page.captureScreenshot') throw new Error('capture failed');
          return {};
        },
        on: () => undefined,
      }),
    );
    await expect(tool('browser.screenshot').run({ view: 'mobile' }, ctx())).rejects.toThrow('capture failed');
    expect(methods()).toContain('Emulation.clearDeviceMetricsOverride');
    expect(pageCalls.at(-1)!.op).toBe('unmask');
  });

  it('captures nothing when the mask cannot be put in place', async () => {
    pageAnswers.mask = () => Promise.reject(new Error('No permission to read the tab'));
    await expect(tool('browser.screenshot').run({}, ctx())).rejects.toThrow('No permission to read the tab');
    expect(withDebugger).not.toHaveBeenCalled();
  });
});

describe('the catalog', () => {
  it('engineToolsFor is empty while off and lists the engine tools while on', () => {
    expect(engineToolsFor({ devtoolsTools: true } as ToolContext['settings']).map((t) => t.name)).toEqual(['browser.click', 'browser.type', 'browser.press_key', 'browser.scroll', 'browser.hover', 'browser.drag', 'browser.screenshot', 'browser.wait_for']);
    expect(engineToolsFor({} as ToolContext['settings'])).toEqual([]);
  });

  it('describes each tool as approved', () => {
    expect(tool('browser.click').description).toBe('Clicks an element by ref with real mouse input, as the user would.');
    expect(tool('browser.hover').description).toBe('Moves the mouse over an element by ref without clicking, as the user would: opens menus and tooltips that show on hover.');
    expect(tool('browser.drag').description).toBe('Drags an element by ref onto another element (to) or by dx/dy pixels, with real mouse input: sliders, boards, reordering.');
    expect(tool('browser.scroll').description).toBe('Scrolls the page (or a scrollable element by ref) with the real mouse wheel, to reveal more content.');
  });
});

describe('a page that does not answer', () => {
  it('an input the page does not answer ends the call and says why', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    blockOn = 'Input.dispatchMouseEvent';
    const error = tool('browser.click').run({ ref: 'ref_1' }, ctx()).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await error).toContain('The page did not respond to the input in 3 s');
    expect(pageCalls.some((c) => c.op === 'context')).toBe(false);
    vi.useRealTimers();
  });

  it('engine click with the switch off fails and never acts synthetically', async () => {
    withDebugger.mockRejectedValueOnce(new Error('Chromium DevTools tools are off: turn them on in Settings → Chromium DevTools.'));
    await expect(tool('browser.click').run({ ref: 'ref_1' }, ctx())).rejects.toThrow(/are off/);
    expect(bridge.actOnPage).not.toHaveBeenCalled();
  });
});

describe('browser.press_key on the engine', () => {
  it('a character', async () => {
    await tool('browser.press_key').run({ key: 'a', ref: 'ref_1' }, ctx());
    expect(sent[1]!.params).toEqual({ type: 'keyDown', key: 'a', text: 'a', modifiers: 0 });
    expect(sent[2]!.params).toEqual({ type: 'keyUp', key: 'a', modifiers: 0 });
  });

  it('Control+a', async () => {
    await tool('browser.press_key').run({ key: 'a', modifiers: ['Control'], ref: 'ref_1' }, ctx());
    expect(sent[1]!.params).toMatchObject({ modifiers: 2 });
  });
});

describe('browser.scroll on the engine', () => {
  it('scroll down sends a wheel of 0.8 of the viewport', async () => {
    await tool('browser.scroll').run({ direction: 'down' }, ctx());
    expect(pageCalls[0]).toEqual({ op: 'wheel-point', host: 'shop.example.test' });
    expect(sent.at(-1)).toEqual({ method: 'Input.dispatchMouseEvent', params: { type: 'mouseWheel', x: 400, y: 300, deltaX: 0, deltaY: 480 } });
  });

  it('scroll left on an element', async () => {
    pageAnswers['wheel-point'] = { x: 50, y: 60, width: 100, height: 40 };
    await tool('browser.scroll').run({ direction: 'left', ref: 'ref_1' }, ctx());
    expect(sent.at(-1)!.params).toMatchObject({ x: 50, y: 60, deltaX: -80, deltaY: 0 });
  });
});

describe('our widget and a tab not shown', () => {
  it('lets the pointer through our widget for the input, and back after', async () => {
    await tool('browser.click').run({ ref: 'ref_1' }, ctx());
    expect(guardCalls).toEqual([{ op: 'input-start', host: 'shop.example.test' }, { op: 'input-end', token: 'g1' }]);
  });

  it('puts our widget back when the input fails', async () => {
    pageAnswers.locate = { ok: false, problem: 'covered', other: 'div "Cookies"' };
    await expect(tool('browser.click').run({ ref: 'ref_1' }, ctx())).rejects.toThrow('covered');
    expect(guardCalls.map((c) => c.op)).toEqual(['input-start', 'input-end']);
  });

  it('acts synthetically on a tab in the background, never attaching, and says so', async () => {
    pageAnswers['input-start'] = { token: 'g1', hidden: true };
    const result = await tool('browser.type').run({ ref: 'ref_1', text: 'hello', submit: true }, ctx());
    expect(withDebugger).not.toHaveBeenCalled();
    expect(pageCalls.some((c) => c.op === 'clear' || c.op === 'locate')).toBe(false);
    expect(bridge.actOnPage).toHaveBeenCalledWith(5, { kind: 'type', ref: 'ref_1', text: 'hello', clear: undefined, submit: true }, 'shop.example.test');
    expect(result.type === 'text' && result.text).toMatch(/Done with synthetic events, not real input: the tab is in the background/);
    expect(guardCalls.map((c) => c.op)).toEqual(['input-start', 'input-end']);
  });

  it('fails clearly on a tab in the background when there is no synthetic way', async () => {
    pageAnswers['input-start'] = { token: 'g1', hidden: true };
    await expect(tool('browser.hover').run({ ref: 'ref_1' }, ctx())).rejects.toThrow('Not done: the tab is in the background');
    await expect(tool('browser.press_key').run({ key: 'a', modifiers: ['Control'] }, ctx())).rejects.toThrow('Not done: the tab is in the background');
    expect(withDebugger).not.toHaveBeenCalled();
  });
});

describe('browser.hover', () => {
  it('moves only', async () => {
    await tool('browser.hover').run({ ref: 'ref_1' }, ctx());
    expect(sent.filter((x) => x.method === 'Input.dispatchMouseEvent').map((x) => x.params)).toEqual([{ type: 'mouseMoved', x: 60, y: 20 }]);
    expect(tool('browser.hover').effect).toBe('write');
  });
});

describe('browser.drag', () => {
  it('to a ref moves in 10 steps', async () => {
    pageAnswers.locate = (req: { ref: string }) => (req.ref === 'ref_1' ? { ok: true, x: 0, y: 0, box: { x: 0, y: 0, width: 2, height: 2 } } : { ok: true, x: 100, y: 50, box: { x: 99, y: 49, width: 2, height: 2 } });
    await tool('browser.drag').run({ ref: 'ref_1', to: 'ref_2' }, ctx());
    const mouse = sent.filter((x) => x.method === 'Input.dispatchMouseEvent').map((x) => x.params!);
    expect(mouse[0]).toMatchObject({ type: 'mouseMoved', x: 0, y: 0 });
    expect(mouse[1]).toMatchObject({ type: 'mousePressed', x: 0, y: 0, button: 'left' });
    expect(mouse.filter((m) => m.type === 'mouseMoved' && m.buttons === 1)).toHaveLength(10);
    expect(mouse.at(-2)).toMatchObject({ type: 'mouseMoved', x: 100, y: 50, buttons: 1 });
    expect(mouse.at(-1)).toMatchObject({ type: 'mouseReleased', x: 100, y: 50 });
  });

  it('by dx/dy', async () => {
    await tool('browser.drag').run({ ref: 'ref_1', dx: 30, dy: -10 }, ctx());
    const last = sent.filter((x) => x.method === 'Input.dispatchMouseEvent').at(-1)!.params!;
    expect(last).toMatchObject({ type: 'mouseReleased', x: 90, y: 10 });
  });

  it('needs to or dx/dy', async () => {
    await expect(tool('browser.drag').run({ ref: 'ref_1' }, ctx())).rejects.toThrow(/to.*dx/);
    await expect(tool('browser.drag').run({ ref: 'ref_1', to: 'ref_2', dx: 1 }, ctx())).rejects.toThrow(/to.*dx/);
  });
});

describe('browser.wait_for networkIdle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    pageAnswers.wait = { done: true, ms: 100, met: [], pending: [] };
  });
  afterEach(() => vi.useRealTimers());
  const waitTool = () => engineTools().find((t) => t.name === 'browser.wait_for')!;

  it('describes the new parameter as approved', () => {
    expect((waitTool().inputSchema as { properties: Record<string, { description?: string }> }).properties.networkIdle!.description).toBe('true: also wait until the page has made no request for half a second.');
  });

  it('networkIdle resolves after 500 ms of quiet', async () => {
    let done = false;
    const run = waitTool().run({ networkIdle: true }, ctx()).then((r) => ((done = true), r));
    await vi.advanceTimersByTimeAsync(400);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    expect(methods()).toEqual(['Network.enable']);
    await run;
  });

  it('waits while a request is in flight', async () => {
    let done = false;
    const run = waitTool().run({ networkIdle: true }, ctx()).then(() => (done = true));
    await vi.advanceTimersByTimeAsync(10);
    emit('Network.requestWillBeSent', { requestId: 'r1', request: { url: 'https://api.example.test/secret' } });
    await vi.advanceTimersByTimeAsync(2000);
    expect(done).toBe(false);
    emit('Network.loadingFinished', { requestId: 'r1' });
    await vi.advanceTimersByTimeAsync(600);
    expect(done).toBe(true);
    await run;
  });

  it('gives up at 15 s', async () => {
    const run = waitTool().run({ networkIdle: true }, ctx());
    await vi.advanceTimersByTimeAsync(10);
    emit('Network.requestWillBeSent', { requestId: 'r1' });
    await vi.advanceTimersByTimeAsync(15_100);
    const result = await run;
    expect(result.type === 'text' && result.text).toContain('The network was still busy after 15 s.');
  });

  it('networkIdle result carries no URL', async () => {
    const run = waitTool().run({ networkIdle: true }, ctx());
    await vi.advanceTimersByTimeAsync(10);
    emit('Network.requestWillBeSent', { requestId: 'r1', request: { url: 'https://api.example.test/secret' } });
    await vi.advanceTimersByTimeAsync(15_100);
    expect(JSON.stringify(await run)).not.toContain('api.example.test');
  });

  it('without networkIdle never attaches', async () => {
    await waitTool().run({}, ctx());
    expect(withDebugger).not.toHaveBeenCalled();
  });
});

describe('the switch, checked first', () => {
  it('type with the switch off touches nothing on the page', async () => {
    engineOn = false;
    await expect(tool('browser.type').run({ ref: 'ref_1', text: 'x' }, ctx())).rejects.toThrow(/are off/);
    expect(pageCalls).toEqual([]);
  });

  it('a screenshot with the switch off masks nothing', async () => {
    engineOn = false;
    await expect(tool('browser.screenshot').run({}, ctx())).rejects.toThrow(/are off/);
    expect(pageCalls).toEqual([]);
  });
});

describe('the phone view, masked again', () => {
  it('marks what the view brought before capturing', async () => {
    pageAnswers.mask = { token: 't1', count: 1 };
    pageAnswers.unmask = true;
    pageAnswers.remask = 0;
    await tool('browser.screenshot').run({ view: 'mobile' }, ctx());
    expect(pageCalls.map((c) => c.op)).toEqual(['mask', 'remask', 'unmask']);
    expect(pageCalls[1]).toEqual({ op: 'remask', token: 't1', selectors: [] });
  });
});

describe('networkIdle, host checked', () => {
  it('does not listen when the tab left the site', async () => {
    pageAnswers.wait = { done: true, ms: 1, met: [], pending: [] };
    tabUrl = 'https://other.example.test/';
    await expect(engineTools().find((t) => t.name === 'browser.wait_for')!.run({ networkIdle: true }, ctx())).rejects.toThrow(/Not done/);
    expect(methods()).not.toContain('Network.enable');
  });
});

describe('pending items, engine', () => {
  beforeEach(() => {
    pageAnswers.mask = { token: 't1', count: 0 };
    pageAnswers.unmask = true;
    pageAnswers.remask = 0;
  });

  it('a ref in the phone view is measured in that view', async () => {
    await tool('browser.screenshot').run({ ref: 'ref_1', view: 'mobile' }, ctx());
    const order = [...sent.map((x) => x.method), ...pageCalls.map((c) => c.op)];
    expect(sent[0]!.method).toBe('Emulation.setDeviceMetricsOverride');
    expect(pageCalls.map((c) => c.op)).toEqual(['mask', 'remask', 'locate', 'unmask']);
    expect(order).toContain('locate');
  });

  it('the phone view emulates touch, and clears it', async () => {
    await tool('browser.screenshot').run({ view: 'mobile' }, ctx());
    expect(methods()).toEqual(['Emulation.setDeviceMetricsOverride', 'Emulation.setTouchEmulationEnabled', 'Page.captureScreenshot', 'Emulation.clearDeviceMetricsOverride', 'Emulation.setTouchEmulationEnabled']);
    expect(sent[1]!.params).toEqual({ enabled: true, maxTouchPoints: 5 });
    expect(sent[4]!.params).toEqual({ enabled: false });
  });

  it('a click cut after the press still releases the button', async () => {
    let n = 0;
    tabUrl = 'https://shop.example.test/cart';
    const original = tabUrl;
    // The host changes after the press: the release is still sent, best effort.
    withDebugger.mockImplementationOnce(async (_t, fn) =>
      fn({
        send: async (method: string, params?: Record<string, unknown>) => {
          sent.push({ method, params });
          if (params?.type === 'mousePressed') tabUrl = 'https://other.example.test/';
          n++;
          return {};
        },
        on: () => undefined,
      }),
    );
    await expect(tool('browser.click').run({ ref: 'ref_1' }, ctx())).rejects.toThrow(/Not done/);
    expect(sent.map((x) => x.params?.type)).toEqual(['mouseMoved', 'mousePressed', 'mouseReleased']);
    expect(n).toBe(3);
    tabUrl = original;
  });

  it('the 3 s message says the page may just be slow', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    blockOn = 'Input.dispatchMouseEvent';
    const error = tool('browser.click').run({ ref: 'ref_1' }, ctx()).catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(3100);
    expect(await error).toBe('The page did not respond to the input in 3 s: it may be busy, or it opened a dialog (alert, confirm). If a dialog is open, ask the user to answer it, then go on.');
    vi.useRealTimers();
  });

  it('the drag card names where it drops', async () => {
    pageAnswers.describe = (req: { ref: string }) => (req.ref === 'ref_2' ? 'listitem "Done"' : 'listitem "Card"');
    const card = await tool('browser.drag').describe!({ ref: 'ref_1', to: 'ref_2' }, ctx());
    expect(card.summary).toBe('Drag listitem "Card" onto listitem "Done" (real input)');
  });
});

describe('marked as DevTools', () => {
  it('the tools that send real input or capture through DevTools say so', () => {
    const via = Object.fromEntries(engineTools().map((t) => [t.name, t.via]));
    for (const name of ['browser.click', 'browser.type', 'browser.press_key', 'browser.scroll', 'browser.hover', 'browser.drag', 'browser.screenshot']) expect(via[name]).toBe('devtools');
    expect(via['browser.wait_for']).toBeUndefined(); // only its networkIdle uses it
  });
});
