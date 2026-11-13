// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { maskSelectorsFor } from '../src/devtools/mask-rules';
import { devtoolsOn } from '../src/storage/settings-select';
import type { Settings } from '../src/storage/settings';
import { DevtoolsSection } from '../src/ui/DevtoolsSettings';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// The browser's debugger API: Chromium has it (with the permission), Firefox does not.
const fake = vi.hoisted(() => ({ browser: { debugger: {} } as Record<string, unknown> }));
vi.mock('wxt/browser', () => fake);
afterEach(() => { fake.browser.debugger = {}; });

function render(settings: Settings) {
  const host = document.createElement('div');
  const root = createRoot(host);
  act(() => root.render(createElement(DevtoolsSection, { settings, onChange: () => undefined })));
  const text = host.textContent ?? '';
  const toggles = host.querySelectorAll('input[type="checkbox"], [role="switch"]').length;
  act(() => root.unmount());
  return { text, toggles };
}

describe('the Chromium DevTools group', () => {
  it('is off unless turned on', () => {
    expect(devtoolsOn({} as Settings)).toBe(false);
    expect(devtoolsOn({ devtoolsTools: true } as Settings)).toBe(true);
  });

  it('stays off where the browser has no debugger API (Firefox), whatever the settings say', () => {
    delete fake.browser.debugger;
    expect(devtoolsOn({ devtoolsTools: true } as Settings)).toBe(false);
  });

  it('is offered in Settings only where the debugger API is', () => {
    const chromium = render({ devtoolsTools: true } as Settings);
    expect(chromium.text).toContain('Run the browser tools on DevTools');
    delete fake.browser.debugger;
    const firefox = render({ devtoolsTools: true } as Settings);
    expect(firefox.text).toContain('This feature is not available in your browser. See the documentation.');
    expect(firefox.text).not.toContain('Run the browser tools on DevTools');
    expect(firefox.toggles).toBe(0);
  });
});

describe('maskSelectorsFor', () => {
  it('reads selectors for a host and its subdomains', () => {
    const rules = '# mine\nexample.com #card\nshop.example.test .cvv\nother.test input';
    expect(maskSelectorsFor(rules, 'example.com')).toEqual(['#card']);
    expect(maskSelectorsFor(rules, 'pay.example.com')).toEqual(['#card']);
    expect(maskSelectorsFor(rules, 'shop.example.test')).toEqual(['.cvv']);
    expect(maskSelectorsFor(undefined, 'example.com')).toEqual([]);
  });

  it('keeps a selector with spaces whole and skips a line without one', () => {
    expect(maskSelectorsFor('example.com form .card input\nexample.com', 'example.com')).toEqual(['form .card input']);
  });
});
