// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { useSplit } from '../src/entrypoints/manager/useSplit';

// The agent manager's divider: a drag the browser cancels (pointercancel, then the capture lost)
// ends as one let go does: the width is kept, and moving no longer resizes.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the manager divider', () => {
  it('ends its drag when the pointer capture is lost', () => {
    localStorage.clear();
    let split!: ReturnType<typeof useSplit>;
    const Probe = () => {
      split = useSplit();
      return createElement('div', null, createElement('span', { id: 'handle', onPointerDown: split.onPointerDown }));
    };
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    act(() => root.render(createElement(Probe)));
    const handle = host.querySelector('#handle') as HTMLElement;
    Object.defineProperty(handle.parentElement, 'clientWidth', { value: 2000 });
    handle.setPointerCapture = () => undefined;
    const pointer = (type: string, clientX = 0) => {
      const e = new MouseEvent(type, { bubbles: true, clientX });
      Object.defineProperty(e, 'pointerId', { value: 1 });
      act(() => void handle.dispatchEvent(e));
    };
    pointer('pointerdown', 400);
    pointer('pointermove', 600);
    expect(split.width).toBe(600);
    pointer('pointercancel');
    pointer('lostpointercapture');
    expect(localStorage.getItem('manager:split')).toBe('600');
    pointer('pointermove', 900);
    expect(split.width).toBe(600);
    act(() => root.unmount());
  });
});
