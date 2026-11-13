// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ToolInfo } from '../src/core/protocol';
import type { Settings } from '../src/storage/settings';
import { SettingsContext } from '../src/ui/settings-context';
import { ToolPanel } from '../src/ui/ToolSettings';

// The tool's side panel: the focus goes in when it opens and back to the tool's row when it closes;
// an Escape in its description being edited leaves the field, the draft kept, and does not close it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const tool = { name: 'browser.find', description: 'Finds things.', effect: 'read', inputSchema: { type: 'object' } } as unknown as ToolInfo;
const escape = (el: Element) => act(() => void el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));

describe('the tool side panel', () => {
  it('takes the focus, keeps a draft on Escape, and gives the focus back', () => {
    document.body.innerHTML = '<button id="tool-browser.find">row</button><div id="host"></div>';
    const row = document.getElementById('tool-browser.find')!;
    row.focus();
    const root = createRoot(document.getElementById('host')!);
    const onClose = vi.fn();
    const panel = (open: boolean) =>
      act(() => root.render(open ? createElement(SettingsContext.Provider, { value: { settings: {} as Settings, update: () => undefined, save: async () => undefined } as never },
        createElement(ToolPanel, { tool, settings: {} as Settings, onChange: () => undefined, onClose, offered: true, onOffer: () => undefined, inMenu: true, onMenu: () => undefined })) : null));
    panel(true);
    const drawer = document.querySelector('.tool-drawer')!;
    expect(document.activeElement).toBe(drawer);
    const edit = [...drawer.querySelectorAll('button')].find((b) => b.textContent === 'Edit')!;
    act(() => edit.click());
    const box = drawer.querySelector('textarea')!;
    box.focus();
    escape(box);
    expect(onClose).not.toHaveBeenCalled();
    expect(drawer.querySelector('textarea')).toBe(box);
    expect(document.activeElement).toBe(drawer);
    escape(drawer);
    expect(onClose).toHaveBeenCalledTimes(1);
    panel(false);
    expect(document.activeElement).toBe(row);
    act(() => root.unmount());
  });
});
