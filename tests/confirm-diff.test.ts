// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { ConfirmationCards } from '../src/entrypoints/sidepanel/ConfirmCards';

// An update's card shows what changes: its diff lines colored by their mark.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
globalThis.ResizeObserver ??= class { observe() {} disconnect() {} unobserve() {} } as unknown as typeof ResizeObserver;

describe('the confirmation card of an update', () => {
  it('marks the lines added and removed', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const confirmation = { kind: 'action' as const, id: 'c', summary: 'Update the skill "notes"', details: [{ label: 'Instructions', value: '  1. Open.\n− 2. Write.\n+ 2. Write it all.', diff: true, code: true }] };
    const agent = { confirmations: [confirmation], respond: vi.fn(), respondAccess: vi.fn(), respondUser: vi.fn() };
    act(() => root.render(createElement(ConfirmationCards, { agent: agent as never })));
    const lines = [...host.querySelectorAll('.confirm-box > div')].map((d) => [d.className, d.textContent]);
    expect(lines).toEqual([['', '  1. Open.'], ['diff-removed', '− 2. Write.'], ['diff-added', '+ 2. Write it all.']]);
    act(() => root.unmount());
    host.remove();
  });
});
