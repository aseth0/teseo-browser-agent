// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { InlineConfirm } from '../src/ui/InlineConfirm';

// Deleting asks first, inside the page: the button turns into the question, Escape goes back.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(onConfirm: () => void) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(createElement(InlineConfirm, { onConfirm, children: (ask: () => void) => createElement('button', { onClick: ask }, 'Remove') })));
  const buttons = () => [...host.querySelectorAll('button')].map((b) => b.textContent);
  const click = (text: string) => act(() => [...host.querySelectorAll('button')].find((b) => b.textContent === text)!.click());
  return { host, root, buttons, click };
}

describe('InlineConfirm', () => {
  it('does nothing on the first click: it asks, focused on the confirming button', () => {
    const onConfirm = vi.fn();
    const { host, root, buttons, click } = mount(onConfirm);
    click('Remove');
    expect(onConfirm).not.toHaveBeenCalled();
    expect(buttons()).toEqual(['Delete', 'Cancel']);
    expect(document.activeElement?.textContent).toBe('Delete');
    click('Delete');
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(buttons()).toEqual(['Remove']);
    act(() => root.unmount());
    host.remove();
  });

  it('goes back on Cancel and on Escape', () => {
    const onConfirm = vi.fn();
    const { host, root, buttons, click } = mount(onConfirm);
    click('Remove');
    click('Cancel');
    expect(buttons()).toEqual(['Remove']);
    click('Remove');
    act(() => host.querySelector('.inline-confirm button')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(buttons()).toEqual(['Remove']);
    expect(onConfirm).not.toHaveBeenCalled();
    act(() => root.unmount());
    host.remove();
  });

  it('gives the focus back to the button that asked, after Escape, Cancel or Delete', () => {
    const { host, root, click } = mount(() => {});
    const asker = () => [...host.querySelectorAll('button')].find((b) => b.textContent === 'Remove');
    click('Remove');
    act(() => document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
    expect(document.activeElement).toBe(asker());
    for (const answer of ['Cancel', 'Delete']) {
      click('Remove');
      const button = [...host.querySelectorAll('button')].find((b) => b.textContent === answer)!;
      button.focus(); // as a click or Tab leaves it
      click(answer);
      expect(document.activeElement).toBe(asker());
    }
    act(() => root.unmount());
    host.remove();
  });

  it('leaves the focus alone when it was not in the question', () => {
    const { host, root, click } = mount(() => {});
    const elsewhere = document.createElement('input');
    document.body.append(elsewhere);
    click('Remove');
    elsewhere.focus();
    click('Cancel');
    expect(document.activeElement).toBe(elsewhere);
    elsewhere.remove();
    act(() => root.unmount());
    host.remove();
  });
});
