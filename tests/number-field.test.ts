// @vitest-environment jsdom
import { act, createElement, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings-types';
import { NumberField } from '../src/ui/NumberField';
import { WebSearchSection } from '../src/ui/WebSearchSettings';

// A number field shown as typed until it is left: "200" can be typed in a field of 50 to 3,000.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const type = async (el: HTMLInputElement, value: string) =>
  act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
const leave = async (el: HTMLInputElement) => act(async () => void el.dispatchEvent(new FocusEvent('focusout', { bubbles: true })));
const enter = async (el: HTMLInputElement) => act(async () => void el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));

// The field as a settings section holds it: what is saved comes back as its value.
function mount(initial: number | undefined) {
  const saved = vi.fn();
  function Holder() {
    const [value, setValue] = useState(initial);
    return createElement(NumberField, { label: 'Words', value, min: 50, max: 3000, placeholder: '400', onSave: (n) => { saved(n); setValue(n); } });
  }
  const box = document.createElement('div');
  act(() => createRoot(box).render(createElement(Holder)));
  return { input: box.querySelector('input')!, saved };
}

describe('NumberField', () => {
  it('keeps what is typed while out of range, and saves it once in range', async () => {
    const { input, saved } = mount(undefined);
    for (const text of ['2', '20', '200']) {
      await type(input, text);
      expect(input.value).toBe(text);
    }
    expect(saved.mock.calls).toEqual([[200]]);
    await leave(input);
    expect(input.value).toBe('200');
    expect(saved.mock.calls).toEqual([[200]]);
  });

  it('clamps an out-of-range number once left, or on Enter', async () => {
    const { input, saved } = mount(400);
    await type(input, '9000');
    expect(saved).not.toHaveBeenCalled();
    await enter(input);
    expect(saved).toHaveBeenLastCalledWith(3000);
    expect(input.value).toBe('3000');
    await type(input, '7');
    await leave(input);
    expect(saved).toHaveBeenLastCalledWith(50);
  });

  it('emptied: stays empty while typing, saved as the default once left', async () => {
    const { input, saved } = mount(400);
    await type(input, '');
    expect(input.value).toBe('');
    expect(saved).not.toHaveBeenCalled();
    await leave(input);
    expect(saved).toHaveBeenLastCalledWith(undefined);
    expect(input.value).toBe('');
    expect(input.placeholder).toBe('400');
  });
});

describe('Settings → Web search → Results per search', () => {
  it('can be cleared to type another number', async () => {
    const onChange = vi.fn();
    const box = document.createElement('div');
    await act(async () => createRoot(box).render(createElement(WebSearchSection, { settings: { webSearch: { results: 5 } } as Settings, onChange })));
    const input = box.querySelector<HTMLInputElement>('[aria-label="Results per search"]')!;
    await type(input, '');
    expect(input.value).toBe('');
    expect(onChange).not.toHaveBeenCalled();
    await type(input, '8');
    expect(onChange).toHaveBeenLastCalledWith({ webSearch: { results: 8 } });
  });
});
