// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { dragArea } from '../src/capture/area';
import { askToOpenChat, layoutSettled, noticeInPage, pageMetrics, scrollPageTo } from '../src/capture/page';

// The functions injected into the page for a capture: self-contained, they run there.
beforeEach(() => {
  vi.stubGlobal('requestAnimationFrame', (f: FrameRequestCallback) => setTimeout(() => f(0), 0));
});

describe('dragArea', () => {
  it('Esc gives up: no area, and the veil is gone', async () => {
    const area = dragArea();
    expect(document.querySelector('ba-veil')).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(await area).toBeNull();
    expect(document.querySelector('ba-veil')).toBeNull();
  });
});

describe('pageMetrics', () => {
  it("the viewport's size, the page's height and where it is scrolled", () => {
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
    expect(pageMetrics()).toEqual({ width: innerWidth, viewport: innerHeight, height: 5000, y: scrollY });
  });
});

describe('scrollPageTo', () => {
  it('scrolls at once and answers where the page ended up', async () => {
    const to = vi.fn();
    vi.stubGlobal('scrollTo', to);
    expect(await scrollPageTo(1200)).toBe(scrollY);
    expect(to).toHaveBeenCalledWith({ top: 1200, left: scrollX, behavior: 'instant' });
  });
});

describe('layoutSettled', () => {
  it('waits until the window has not been resized for a moment (the side panel just opened)', async () => {
    vi.useFakeTimers();
    let done = false;
    void layoutSettled().then(() => (done = true));
    await vi.advanceTimersByTimeAsync(100);
    dispatchEvent(new Event('resize'));
    await vi.advanceTimersByTimeAsync(100);
    expect(done).toBe(false); // resized 100 ms ago
    await vi.advanceTimersByTimeAsync(200);
    expect(done).toBe(true);
    vi.useRealTimers();
  });
  it('not longer than half a second, however it keeps resizing', async () => {
    vi.useFakeTimers();
    let done = false;
    void layoutSettled().then(() => (done = true));
    for (let i = 0; i < 10; i++) {
      dispatchEvent(new Event('resize'));
      await vi.advanceTimersByTimeAsync(60);
    }
    expect(done).toBe(true);
    vi.useRealTimers();
  });
});

describe('askToOpenChat', () => {
  const at = { x: 10, y: 20, width: 100, height: 50 };
  const answers = (...opened: boolean[]) => {
    const sendMessage = vi.fn(async (_m: unknown) => ({ opened: opened.shift() ?? false }));
    vi.stubGlobal('chrome', { runtime: { sendMessage } });
    return sendMessage;
  };
  const button = () => document.querySelector('ba-attach') as HTMLElement | null;
  it('opened while the drag\'s gesture lasts: no button', async () => {
    const send = answers(true);
    await askToOpenChat('open-chat', at);
    expect(send).toHaveBeenCalledWith({ type: 'open-chat' });
    expect(button()).toBeNull();
  });
  it('refused: a button by the section asks again from its click, and goes once it opened', async () => {
    const send = answers(false, true);
    await askToOpenChat('open-chat', at);
    expect(button()).not.toBeNull();
    button()!.click();
    await vi.waitFor(() => expect(button()).toBeNull());
    expect(send).toHaveBeenCalledTimes(2);
  });
  it('Esc, or a click elsewhere, puts the button away', async () => {
    answers(false, false);
    await askToOpenChat('open-chat', at);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(button()).toBeNull();
    await askToOpenChat('open-chat', at);
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, composed: true }));
    expect(button()).toBeNull();
  });
});

describe('noticeInPage', () => {
  beforeEach(() => document.querySelector('ba-notice')?.remove());
  const shown = () => document.querySelector('ba-notice');
  it('says it in a note over the page, out of its styles', () => {
    noticeInPage('Needs access to every site');
    expect(shown()).not.toBeNull();
    expect(shown()?.getAttribute('role')).toBe('status');
  });
  it('one at a time', () => {
    noticeInPage('one');
    noticeInPage('two');
    expect(document.querySelectorAll('ba-notice')).toHaveLength(1);
  });
  it('Esc, or a click anywhere, puts it away', () => {
    noticeInPage('x');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(shown()).toBeNull();
    noticeInPage('x');
    document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(shown()).toBeNull();
  });
  it('goes by itself after a while', () => {
    vi.useFakeTimers();
    noticeInPage('x');
    vi.advanceTimersByTime(10_000);
    expect(shown()).toBeNull();
    vi.useRealTimers();
  });
});
