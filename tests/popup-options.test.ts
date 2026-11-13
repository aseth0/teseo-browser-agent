// @vitest-environment jsdom
// Settings → Appearance → Popup: a switch per item, kept as what is hidden.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings';

// Chrome's APIs a tab's audio needs; Firefox has neither (see the last test).
const chrome = { runtime: { getURL: (p: string) => p }, tabCapture: {}, offscreen: {} };
vi.mock('wxt/browser', () => ({ browser: chrome }));
const { PopupOptions } = await import('../src/ui/PopupOptions');

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

async function show(popup?: Settings['popup']) {
  const onChange = vi.fn();
  const box = document.createElement('div');
  await act(async () => createRoot(box).render(createElement(PopupOptions, { settings: { providers: [], systemPrompt: '', popup } as Settings, onChange })));
  const sw = (name: string) => box.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
  return { onChange, sw };
}

describe('the Popup tab', () => {
  it('everything on by default; turning one off hides it', async () => {
    const { onChange, sw } = await show();
    expect(['Site access', 'Page', 'Panel', 'Full screen', 'Screenshot', 'Section', "Tab's audio", 'Requests', 'Agents Panel', 'Shortcuts', 'Block titles'].every((n) => sw(n).checked)).toBe(true);
    await act(async () => sw('Requests').click());
    expect(onChange).toHaveBeenCalledWith({ popup: { hidden: ['requests'] } });
    await act(async () => sw('Block titles').click());
    expect(onChange).toHaveBeenLastCalledWith({ popup: { noTitles: true } });
  });
  it('turning one back on shows it; the screenshots off with Screenshot', async () => {
    const { onChange, sw } = await show({ hidden: ['screenshot', 'agents'] });
    expect(sw('Section').disabled).toBe(true);
    await act(async () => sw('Agents Panel').click());
    expect(onChange).toHaveBeenCalledWith({ popup: { hidden: ['screenshot'] } });
  });
  // Where the browser cannot capture a tab's audio: build-notices.test.
});
