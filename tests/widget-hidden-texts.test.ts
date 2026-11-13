// @vitest-environment jsdom
// What the user reads about hiding the bubble on a site: nothing of it runs there until it is shown
// again (Settings → Bubble's list of hidden sites, and the actions' "on load" mark).
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(fakeStorage(), { runtime: { id: 'ext-id', getURL: (p: string) => `chrome-extension://ext-id${p}` } }) }));
const { HiddenSites } = await import('../src/ui/bubble/BubbleSettings');

describe('Settings → Bubble, the sites it is hidden on', () => {
  it('says that nothing of the bubble runs there until it is shown again', () => {
    const el = document.createElement('div');
    act(() => createRoot(el).render(createElement(HiddenSites, { hidden: ['shop.example.com'] })));
    expect(el.textContent).toContain('shop.example.com');
    expect(el.querySelector('.hint')!.textContent).toMatch(/nothing of the bubble runs, not even its actions on page load, until you show it again/);
  });
});
