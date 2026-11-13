// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Browser } from 'wxt/browser';
import { fakeBrowser, fakeStorage } from './fakes/browser';

// "+ New agent": the tab chosen stays chosen while rows are added or removed, as long as it can be.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tab = (id: number, lastAccessed: number) => ({ id, lastAccessed, title: `T${id}`, url: `https://t${id}.example.com/a` }) as Browser.tabs.Tab;
const open = [tab(1, 40), tab(2, 30), tab(3, 20)];
const browser = fakeBrowser(fakeStorage());
Object.assign(browser, { tabs: { query: async () => open, getCurrent: async () => undefined } });
vi.mock('wxt/browser', () => ({ browser }));
vi.mock('../src/ui/useCollection', () => ({ useCollection: () => [] }));
const { NewAgentDialog } = await import('../src/entrypoints/manager/NewAgentDialog');

describe('NewAgentDialog', () => {
  it('keeps the chosen tab when another row is added, and starts the agent on it', async () => {
    const onStart = vi.fn();
    const box = document.body.appendChild(document.createElement('div')); // a form submits only in the document
    const root = createRoot(box);
    const render = (taken: number[]) => act(async () => root.render(createElement(NewAgentDialog, { settings: {} as never, taken, onStart, onClose: () => {} })));
    await render([]);
    const select = box.querySelector<HTMLSelectElement>('select')!;
    expect(select.value).toBe('1');
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, '3');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await render([2]); // a row was added on tab 2
    expect(select.value).toBe('3');
    await act(async () => box.querySelector<HTMLButtonElement>('button[type="submit"]')!.click());
    expect(onStart).toHaveBeenCalledWith(3, undefined);
    await render([2, 3]); // now the chosen one is taken: the first left
    expect(select.value).toBe('1');
  });
});
