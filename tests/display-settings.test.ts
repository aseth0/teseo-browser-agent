// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Settings } from '../src/storage/settings-types';

// Settings → Display: built from the registry, the elements by where they are, a switch for shown or
// hidden and buttons for the others; the locked ones listed apart, with why. A value set back to the
// default is not stored.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (path: string) => `chrome-extension://test${path}` } } }));
const { DisplaySection } = await import('../src/ui/DisplaySettings');
const { DISPLAY_DEFS } = await import('../src/core/display-defs');

let root: Root | undefined;
afterEach(() => act(() => root?.unmount()));

function render(display?: Settings['display']) {
  const host = document.createElement('div');
  root = createRoot(host);
  const onChange = vi.fn();
  const settings = { providers: [], systemPrompt: '', display } as Settings;
  act(() => root!.render(createElement(DisplaySection, { settings, onChange })));
  const group = (label: string) => host.querySelector(`ul[aria-label="${label}"]`)!;
  return { host, onChange, group };
}

describe('Settings → Display', () => {
  it('groups the elements by where they are, with the preview', () => {
    const { host, group } = render();
    expect(host.querySelector('h3')!.textContent).toBe('Display');
    expect(host.querySelector('iframe.panel-preview')!.getAttribute('src')).toContain('sidepanel.html?preview');
    expect(group('Tool calls').textContent).toContain(DISPLAY_DEFS.toolArgs.label);
    expect(group('Under the answer').textContent).toContain(DISPLAY_DEFS.answerStats.label);
    expect(group('Tool calls').textContent).not.toContain(DISPLAY_DEFS.answerStats.label);
  });

  it('lists the locked ones as always shown, with why, and no control', () => {
    const { group } = render({ cutMark: 'hidden' });
    const locked = group('Always shown');
    for (const id of ['untrustedMark', 'toolErrors', 'cutMark', 'devtoolsBadge'] as const) {
      expect(locked.textContent).toContain(DISPLAY_DEFS[id].label);
      expect(locked.textContent).toContain(DISPLAY_DEFS[id].why);
    }
    expect(locked.querySelector('button, input')).toBeNull();
    expect(group('Tool calls').textContent).not.toContain(DISPLAY_DEFS.cutMark.label);
  });

  it('stores a value changed, and drops it when set back to the default', () => {
    const { host, onChange } = render({ toolTab: 'hidden' });
    const fields = [...host.querySelectorAll<HTMLButtonElement>('[role="group"][aria-label="Arguments"] button')].find((b) => b.textContent === 'Fields')!;
    act(() => fields.click());
    expect(onChange).toHaveBeenLastCalledWith({ display: { toolTab: 'hidden', toolArgs: 'fields' } });
    const tab = host.querySelector<HTMLInputElement>('input[aria-label="Tab chip"]')!;
    expect(tab.checked).toBe(false);
    act(() => tab.click());
    expect(onChange).toHaveBeenLastCalledWith({ display: {} });
  });

  it('shows a value this build does not have as the default', () => {
    const { host } = render({ toolArgs: 'table' });
    const pressed = host.querySelector('[role="group"][aria-label="Arguments"] button[aria-pressed="true"]')!;
    expect(pressed.textContent).toBe('JSON');
  });
});
