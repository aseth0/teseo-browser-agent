// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import type { Message } from '../src/core/types';
import { useFollowScroll } from '../src/entrypoints/sidepanel/useFollowScroll';

// A card asking you, an error or the step limit's Continue changes neither the history nor the
// streamed text: it is still brought into view, unless you scrolled up.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const history: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'Hi' }] }];
let list!: HTMLDivElement;
let scrolled!: (e: { currentTarget: HTMLDivElement }) => void;
function List({ below }: { below: string }) {
  const { listRef, onScroll } = useFollowScroll(history, false, undefined, below);
  scrolled = onScroll as never;
  return createElement('div', { ref: (el: HTMLDivElement | null) => { if (el) { list = el; (listRef as { current: HTMLDivElement }).current = el; } } });
}
const sized = (el: HTMLDivElement, scrollHeight: number) => {
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: 100 });
};

describe('following what shows under the conversation', () => {
  it('brings a new card into view while at the end, not after scrolling up', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(List, { below: '0' })));
    sized(list, 1000);
    list.scrollTop = 900;
    act(() => scrolled({ currentTarget: list }));
    sized(list, 1300);
    act(() => root.render(createElement(List, { below: '1' })));
    expect(list.scrollTop).toBe(1300);
    list.scrollTop = 200;
    act(() => scrolled({ currentTarget: list }));
    sized(list, 1600);
    act(() => root.render(createElement(List, { below: '2' })));
    expect(list.scrollTop).toBe(200);
    act(() => root.unmount());
  });
});
