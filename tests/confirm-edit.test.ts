// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationCards } from '../src/entrypoints/sidepanel/ConfirmCards';
import type { ActionDetail } from '../src/core/types';

// A save's card lets the user edit its main fields before allowing it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;

const DETAILS: ActionDetail[] = [
  { label: 'Name', value: '', editOnly: true, edit: { field: 'name', value: 'notes' } },
  { label: 'Description', value: 'Takes notes', edit: { field: 'description', value: 'Takes notes' } },
  { label: 'Instructions', value: '1. Open.', code: true, edit: { field: 'instructions', value: '1. Open.', lines: 'text' } },
  { label: 'Pinned', value: 'No' },
];

function mount(extra: { details?: ActionDetail[]; problem?: string; edited?: Record<string, string> } = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  const respond = vi.fn();
  const confirmation = { kind: 'action' as const, id: 'c', summary: 'Save the skill "notes"', host: '', details: DETAILS, ...extra };
  act(() => root.render(createElement(ConfirmationCards, { agent: { confirmations: [confirmation], respond, respondAccess: vi.fn(), respondUser: vi.fn() } as never })));
  const button = (text: string) => [...host.querySelectorAll('button')].find((b) => b.textContent === text);
  const click = (text: string) => act(() => button(text)!.click());
  const labels = () => [...host.querySelectorAll('dt')].map((d) => d.textContent);
  const field = (label: string) => host.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[aria-label="${label}"]`);
  const type = (label: string, value: string) =>
    act(() => {
      const el = field(label)!;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')!.set!;
      setter.call(el, value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
  const unmount = () => {
    act(() => root.unmount());
    host.remove();
  };
  return { host, respond, button, click, labels, field, type, unmount };
}

describe('editing a save on its card', () => {
  it('offers Edit only when a field is editable', () => {
    const plain = mount({ details: [{ label: 'Pinned', value: 'No' }] });
    expect(plain.button('Edit')).toBeUndefined();
    plain.unmount();
  });

  it('shows the fields as inputs, the rows of empty ones only while editing, and Cancel goes back', () => {
    const card = mount();
    expect(card.labels()).toEqual(['Action', 'Description', 'Instructions', 'Pinned']);
    card.click('Edit');
    expect(card.labels()).toEqual(['Action', 'Name', 'Description', 'Instructions', 'Pinned']);
    expect(card.field('Name')?.value).toBe('notes');
    expect(card.field('Instructions')?.tagName).toBe('TEXTAREA');
    card.type('Description', 'Changed');
    card.click('Cancel editing');
    expect(card.field('Description')).toBeNull();
    card.click('Edit');
    expect(card.field('Description')?.value).toBe('Takes notes');
    card.unmount();
  });

  it('sends only the values changed with Allow, none with Deny', () => {
    const card = mount();
    card.click('Edit');
    card.type('Description', 'Keeps notes');
    card.type('Name', 'notes');
    card.click('Allow');
    expect(card.respond).toHaveBeenLastCalledWith('c', 'allow', '', { description: 'Keeps notes' });
    card.click('Deny');
    expect(card.respond).toHaveBeenLastCalledWith('c', 'deny', '', undefined);
    card.unmount();
  });

  it('asked again, opens editing their values and says why', () => {
    const card = mount({ problem: 'Not saved:\n- Give a description.', edited: { description: '' } });
    expect(card.field('Description')?.value).toBe('');
    expect(card.field('Instructions')?.value).toBe('1. Open.');
    expect(card.host.querySelector('[role="alert"]')?.textContent).toBe('Not saved:\n- Give a description.');
    card.unmount();
  });
});
