// jsdom has no Element.checkVisibility, which the vendored Playwright role utilities call (browsers all
// have it): an approximation from the computed styles of the element and its ancestors. Its own style
// reads go to the original getComputedStyle, so tests that count the snapshot's reads see only those.
export function polyfillCheckVisibility(win: Window & typeof globalThis): void {
  if ('checkVisibility' in win.Element.prototype) return;
  const styleOf = win.getComputedStyle.bind(win);
  Object.defineProperty(win.Element.prototype, 'checkVisibility', {
    configurable: true,
    value(this: Element) {
      for (let el: Element | null = this; el; el = el.parentElement) {
        if (el.hasAttribute('hidden') || styleOf(el).display === 'none') return false;
      }
      return true;
    },
  });
}

if (typeof window !== 'undefined') polyfillCheckVisibility(window);
