// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// A click in Settings whose work fails says so in its section, instead of failing silently (or as an
// unhandled rejection).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('wxt/browser', () => ({ browser: { runtime: { getManifest: () => ({ version: '1' }) } } }));
vi.mock('../src/logs/actions', () => ({
  DEFAULT_LOG_MODE: 'session',
  clearActionLog: async () => undefined,
  loadActionLog: async () => { throw new Error('The log cannot be read'); },
  onActionLogChanged: () => () => undefined,
}));
vi.mock('../src/mcp/logs', () => ({ loadMcpLogs: async () => [] }));
const { PageKey } = await import('../src/ui/ShortcutsSettings');
const { LogsSection } = await import('../src/ui/LogsSettings');

const render = async (el: ReturnType<typeof createElement>) => {
  const host = document.createElement('div');
  const root = createRoot(host);
  await act(async () => root.render(el));
  return { host, root };
};
const click = async (button: Element | undefined) => act(async () => void (button as HTMLButtonElement).click());

describe('a click whose work fails', () => {
  it('says why a key could not be saved', async () => {
    const table = { keys: { open: { code: 'KeyK', alt: true } }, setKey: () => Promise.reject(new Error('Storage is full')), everySite: true, mac: false, rows: [], shortcuts: [] };
    const { host, root } = await render(createElement(PageKey, { name: 'open', table: table as never }));
    await click(host.querySelector('[aria-label="Clear the key"]')!);
    expect(host.querySelector('[role="alert"]')?.textContent).toBe('Storage is full');
    act(() => root.unmount());
  });

  it('says why the logs could not be exported', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { host, root } = await render(createElement(LogsSection, { settings: { providers: [] } as never, onChange: () => undefined }));
    await click([...host.querySelectorAll('button')].find((b) => b.textContent === 'Export'));
    expect(host.querySelector('.error-text[role="alert"]')?.textContent).toBe('The log cannot be read');
    act(() => root.unmount());
  });
});
