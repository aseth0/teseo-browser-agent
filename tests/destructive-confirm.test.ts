// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { ActionLogEntry } from '../src/logs/actions';
import type { Settings } from '../src/storage/settings-types';

// What cannot be undone asks first, inside the page: restoring a text edited, clearing the action log.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const clearActionLog = vi.fn(async () => {});
const entry = { at: 0, tool: 'browser.click', source: 'chat', decision: 'free', ok: true } as unknown as ActionLogEntry;
vi.mock('../src/logs/actions', () => ({ clearActionLog, DEFAULT_LOG_MODE: 'session', loadActionLog: async () => [entry], onActionLogChanged: () => () => {} }));
vi.mock('../src/mcp/logs', () => ({ loadMcpLogs: async () => [] }));
vi.mock('wxt/browser', () => ({ browser: {} }));
const { EditableText } = await import('../src/ui/EditableText');
const { LogsSection } = await import('../src/ui/LogsSettings');

async function mount(element: ReturnType<typeof createElement>) {
  const box = document.body.appendChild(document.createElement('div'));
  await act(async () => createRoot(box).render(element));
  const click = (text: string) => act(async () => [...box.querySelectorAll('button')].find((b) => b.textContent === text)!.click());
  return { box, click };
}

describe('asked first', () => {
  it('Restore default of an edited text', async () => {
    const onSave = vi.fn();
    const { box, click } = await mount(createElement(EditableText, { label: 'Your system prompt', defaultText: 'Default.', value: 'Mine.', onSave }));
    await click('Restore default');
    expect(onSave).not.toHaveBeenCalled();
    expect(box.textContent).toContain('Discard your edit?');
    await click('Restore default');
    expect(onSave).toHaveBeenCalledWith(undefined);
  });

  it('Clear of the action log', async () => {
    const { box, click } = await mount(createElement(LogsSection, { settings: {} as Settings, onChange: () => {} }));
    await click('Clear');
    expect(clearActionLog).not.toHaveBeenCalled();
    expect(box.textContent).toContain('Clear the action log?');
    await click('Clear');
    expect(clearActionLog).toHaveBeenCalledOnce();
  });
});
