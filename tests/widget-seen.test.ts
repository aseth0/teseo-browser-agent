// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { runtime: {} } }));
const { whenSeen } = await import('../src/widget/ui/confirm');
const { pin } = await import('../src/widget/ui/dom');

// The browser's verdict on the card, given by hand: what IntersectionObserver v2 would report (v1's
// fields alone, in a browser without v2).
let report: (seen: { isIntersecting: boolean; isVisible?: boolean; intersectionRatio?: number }) => void = () => undefined;
let watching = false;
class FakeObserver {
  constructor(callback: (entries: unknown[]) => void) {
    report = (seen) => callback([seen]);
  }
  observe() {
    watching = true;
  }
  disconnect() {
    watching = false;
  }
}

// A browser with IntersectionObserver v2 (Chromium): its entries have isVisible.
class EntryV2 {
  get isVisible() {
    return false;
  }
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserverEntry', EntryV2);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the page widget's confirmation card", () => {
  it('lets Allow work only once it has been seen whole for a moment, and not while covered', () => {
    vi.useFakeTimers();
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const card = document.body.appendChild(document.createElement('div'));
    const allow = card.appendChild(document.createElement('button'));
    whenSeen(card, [allow], () => false);
    expect(allow.disabled).toBe(true);
    report({ isIntersecting: true, isVisible: true });
    vi.advanceTimersByTime(400);
    expect(allow.disabled).toBe(true);
    vi.advanceTimersByTime(200);
    expect(allow.disabled).toBe(false);
    report({ isIntersecting: true, isVisible: false }); // covered or made see-through
    expect(allow.disabled).toBe(true);
    vi.advanceTimersByTime(1000);
    expect(allow.disabled).toBe(true);
  });

  it('stops watching once decided', () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    const card = document.body.appendChild(document.createElement('div'));
    const allow = card.appendChild(document.createElement('button'));
    let decided = false;
    whenSeen(card, [allow], () => decided);
    expect(watching).toBe(true);
    decided = true;
    report({ isIntersecting: false, isVisible: false }); // removed from the page
    expect(watching).toBe(false);
  });

  describe('moved under the pointer', () => {
    // A card in its host's shadow root, as the widget's is, where the page's layout puts the host.
    const inHost = () => {
      const host = document.body.appendChild(document.createElement('div'));
      let at = { left: 100, top: 100 };
      host.getBoundingClientRect = () => ({ ...at, width: 50, height: 50 }) as DOMRect;
      pin(host, { transform: 'translate(100px, 100px)' });
      const card = host.attachShadow({ mode: 'closed' }).appendChild(document.createElement('div'));
      const allow = card.appendChild(document.createElement('button'));
      const moveTo = (left: number, top: number) => (at = { left, top });
      return { host, allow, moveTo, inPlace: whenSeen(card, [allow], () => false) };
    };
    const seen = () => {
      report({ isIntersecting: true, isVisible: true });
      vi.advanceTimersByTime(600);
    };

    it('turns Allow off for a moment when the page rewrites its host to move it', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('IntersectionObserver', FakeObserver);
      const { host, allow, moveTo } = inHost();
      seen();
      expect(allow.disabled).toBe(false);
      host.style.setProperty('transform', 'translate(300px, 300px)', 'important');
      moveTo(300, 300);
      await Promise.resolve(); // the mutation is reported
      expect(allow.disabled).toBe(true);
      vi.advanceTimersByTime(600);
      expect(allow.disabled).toBe(false);
    });

    it("keeps Allow on when the widget moves it itself", async () => {
      vi.useFakeTimers();
      vi.stubGlobal('IntersectionObserver', FakeObserver);
      const { host, allow, moveTo, inPlace } = inHost();
      seen();
      pin(host, { transform: 'translate(300px, 300px)' });
      moveTo(300, 300);
      await Promise.resolve();
      expect(allow.disabled).toBe(false);
      expect(inPlace()).toBe(true);
    });

    it('refuses a press after a move it was not told of (a rule, an ancestor), and turns Allow off for a moment', () => {
      vi.useFakeTimers();
      vi.stubGlobal('IntersectionObserver', FakeObserver);
      const { allow, moveTo, inPlace } = inHost();
      seen();
      moveTo(300, 300);
      expect(inPlace()).toBe(false);
      expect(allow.disabled).toBe(true);
      vi.advanceTimersByTime(600);
      expect([allow.disabled, inPlace()]).toEqual([false, true]);
    });
  });

  describe('in a browser without IntersectionObserver v2 (Firefox)', () => {
    let hidden = false;
    beforeEach(() => {
      vi.useFakeTimers();
      vi.stubGlobal('IntersectionObserverEntry', class {});
      vi.stubGlobal('IntersectionObserver', FakeObserver);
      hidden = false;
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
    });
    afterEach(() => {
      delete (document as { visibilityState?: unknown }).visibilityState;
    });
    const card = () => {
      const c = document.body.appendChild(document.createElement('div'));
      const allow = c.appendChild(document.createElement('button'));
      whenSeen(c, [allow], () => false);
      return allow;
    };

    it('lets Allow work once the card has been on screen whole, in a shown page, for a moment', () => {
      const allow = card();
      report({ isIntersecting: true, intersectionRatio: 1 });
      vi.advanceTimersByTime(400);
      expect(allow.disabled).toBe(true);
      vi.advanceTimersByTime(200);
      expect(allow.disabled).toBe(false);
    });

    it('keeps Allow off while the card is partly off screen, or the page is hidden', () => {
      const allow = card();
      report({ isIntersecting: true, intersectionRatio: 0.5 });
      vi.advanceTimersByTime(1000);
      expect(allow.disabled).toBe(true);
      report({ isIntersecting: true, intersectionRatio: 1 });
      vi.advanceTimersByTime(1000);
      hidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      expect(allow.disabled).toBe(true);
      hidden = false;
      document.dispatchEvent(new Event('visibilitychange'));
      vi.advanceTimersByTime(600);
      expect(allow.disabled).toBe(false);
    });
  });
});
