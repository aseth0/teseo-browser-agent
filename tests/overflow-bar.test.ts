// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OverflowBar } from '../src/ui/OverflowBar';

// A bar that never wraps: what does not fit goes behind ⋯ whatever its parts' widths become after
// it was laid out (the tools' count, the agent's name, the model, shown once loaded), and its title
// keeps its whole width while there are buttons left to put away.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// jsdom lays nothing out: a part's width is its `data-w`, a wrapper's that of what it holds, and the
// bar's title shrinks like a flex item with `min-width: 0` when the rest does not leave it room.
const PAD = 12;
const GAP = 4;
let barWidth = 0;
const natural = (el: Element): number =>
  el.classList.contains('bar-more') ? 28 : el.hasAttribute('data-w') ? Number(el.getAttribute('data-w')) : [...el.children].reduce((sum, c) => sum + natural(c), 0);
function laidOut(el: HTMLElement): number {
  if (el.classList.contains('overflow-bar')) return barWidth;
  if (!el.classList.contains('bar-lead')) return natural(el);
  const parts = [...el.parentElement!.children];
  const others = parts.filter((c) => c !== el).reduce((sum, c) => sum + natural(c), 0) + GAP * (parts.length - 1);
  return Math.max(0, Math.min(natural(el), barWidth - 2 * PAD - others));
}

// A ResizeObserver that reports a target when its width changed since it last did (at first, always).
const observers = new Set<FakeObserver>();
class FakeObserver {
  seen = new Map<Element, number | undefined>();
  constructor(readonly report: () => void) { observers.add(this); }
  observe(el: Element) { if (!this.seen.has(el)) this.seen.set(el, undefined); }
  unobserve(el: Element) { this.seen.delete(el); }
  disconnect() { this.seen.clear(); observers.delete(this); }
  changed() {
    let any = false;
    for (const [el, was] of this.seen) {
      const now = laidOut(el as HTMLElement);
      if (now !== was) (this.seen.set(el, now), (any = true));
    }
    return any;
  }
}
// What the browser does after each layout: report the sizes that changed, until none does.
function settle() {
  for (let round = 0; round < 10; round++) {
    const due = [...observers].filter((o) => o.changed());
    if (!due.length) return;
    act(() => due.forEach((o) => o.report()));
  }
  throw new Error('the bar never settles');
}

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', FakeObserver);
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) { return laidOut(this); });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) { return laidOut(this); });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) { return Math.max(laidOut(this), natural(this)); });
  const style = window.getComputedStyle;
  vi.spyOn(window, 'getComputedStyle').mockImplementation((el) =>
    (el as Element).classList.contains('overflow-bar') ? ({ paddingLeft: `${PAD}px`, paddingRight: `${PAD}px` } as CSSStyleDeclaration) : style(el));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  observers.clear();
  document.body.innerHTML = '';
});

const part = (w: number) => createElement('span', { 'data-w': w });
const shown = (bar: Element) => [...bar.querySelectorAll<HTMLElement>(':scope > [data-bar-item]')].map((el) => el.dataset.barItem);
// Every part of the bar within its padding (the title at its whole width).
const fits = (bar: Element) =>
  [...bar.children].reduce((sum, c) => sum + natural(c), 0) + GAP * (bar.children.length - 1) <= barWidth - 2 * PAD;

function mount(node: React.ReactElement) {
  const host = document.body.appendChild(document.createElement('div'));
  act(() => createRoot(host).render(node));
  settle();
  return host.querySelector('.overflow-bar')!;
}

describe('OverflowBar', () => {
  it('puts away what no longer fits when a part grows after it was laid out', () => {
    barWidth = 300; // 276 inside its padding; the model (the tail) takes 36 of it with its gap
    let grow!: (w: number) => void;
    function Composer() {
      const [agent, setAgent] = useState(40);
      grow = setAgent;
      return createElement(OverflowBar, {
        className: 'composer-actions', label: 'message box buttons', hideFrom: 'start', trayAbove: true, tail: part(32),
        items: ['new', 'attach', 'tools', 'thinking'].map((key) => ({ key, node: part(40) })).concat({ key: 'agent', node: part(agent) }),
      });
    }
    const bar = mount(createElement(Composer));
    expect(shown(bar)).toEqual(['new', 'attach', 'tools', 'thinking', 'agent']);
    expect(bar.querySelector('.bar-more')).toBeNull();

    act(() => grow(100)); // its name, once the agents are loaded
    settle();
    expect(bar.querySelector('.bar-more')).not.toBeNull();
    expect(shown(bar)[0]).not.toBe('new'); // from the left
    expect(shown(bar).at(-1)).toBe('agent');
    expect(fits(bar)).toBe(true);
  });

  it('keeps its title whole while buttons can go behind ⋯', () => {
    barWidth = 334; // 310 inside its padding
    let fill!: () => void;
    function Topbar() {
      const [filled, setFilled] = useState(false);
      fill = () => setFilled(true);
      return createElement(OverflowBar, {
        className: 'topbar', label: 'top bar', hideFrom: 'end', lead: part(150), tail: part(32),
        items: ['text-size', 'record', 'temporary', 'move'].map((key) => ({ key, node: part(filled || key === 'text-size' || key === 'move' ? 32 : 0) })),
      });
    }
    const bar = mount(createElement(Topbar));
    expect(bar.querySelector('.bar-more')).toBeNull();

    act(() => fill()); // the chat's buttons, put in their slots once it is up
    settle();
    expect(bar.querySelector('.bar-more')).not.toBeNull();
    expect(shown(bar)[0]).toBe('text-size'); // from the right
    expect(bar.querySelector<HTMLElement>('.bar-lead')!.offsetWidth).toBe(150);
    expect(fits(bar)).toBe(true);
  });
});
