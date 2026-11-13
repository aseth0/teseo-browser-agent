// @vitest-environment jsdom
import { act, createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { Popover } from '../src/ui/Popover';

// A menu in a popover works from the keyboard: it starts on its first item, the arrows move, and
// Escape or a choice gives the focus back to the button that opened it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(panel: (close: () => void) => ReturnType<typeof h>) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(h(Popover, { title: 'Open', label: 'Open', children: panel })));
  const trigger = host.querySelector<HTMLButtonElement>('.popover > button')!;
  const key = (key: string) => act(() => void document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })));
  const unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, trigger, key, unmount };
}

const menu = (close: () => void) =>
  h('div', { role: 'menu' },
    h('button', { role: 'menuitemradio', onClick: close }, 'One'),
    h('label', { role: 'menuitemcheckbox' }, h('input', { type: 'checkbox' }), 'Two'),
    h('button', { role: 'menuitem', onClick: close }, 'Three'));

describe('Popover', () => {
  it('starts on the first item, and the arrows, Home and End move between them', () => {
    const { trigger, key, unmount } = mount(menu);
    act(() => trigger.click());
    expect(document.activeElement?.textContent).toBe('One');
    key('ArrowDown');
    expect(document.activeElement).toBeInstanceOf(HTMLInputElement); // the checkbox of a <label> item
    key('ArrowDown');
    expect(document.activeElement?.textContent).toBe('Three');
    key('ArrowDown');
    expect(document.activeElement?.textContent).toBe('One');
    key('ArrowUp');
    expect(document.activeElement?.textContent).toBe('Three');
    key('Home');
    expect(document.activeElement?.textContent).toBe('One');
    key('End');
    expect(document.activeElement?.textContent).toBe('Three');
    unmount();
  });

  it('gives the focus back to its button on Escape and after a choice, not after a click outside', () => {
    const { host, trigger, key, unmount } = mount(menu);
    act(() => trigger.click());
    key('Escape');
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    act(() => trigger.click());
    act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Three')!.click());
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    const outside = document.createElement('input');
    document.body.append(outside);
    act(() => trigger.click());
    outside.focus();
    act(() => void outside.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })));
    expect(host.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
    unmount();
  });

  it('leaves the keys of a field outside a menu to it', () => {
    const { host, trigger, key, unmount } = mount(() => h('div', null, h('input', { autoFocus: true }), h('div', { role: 'menu' }, h('button', { role: 'menuitem' }, 'One'))));
    act(() => trigger.click());
    const field = host.querySelector('input')!;
    field.focus();
    key('Home');
    expect(document.activeElement).toBe(field);
    unmount();
  });
});
