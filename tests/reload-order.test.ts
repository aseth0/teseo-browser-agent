// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// What Settings reads again on a signal (the shortcuts when the page shows again, the tool catalog
// when the tools change): a read that comes back after a later one does not undo it.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
type Pending<T> = { resolve: (v: T) => void; promise: Promise<T> };
const pending = <T,>(): Pending<T> => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { resolve, promise };
};
const reads: Pending<unknown>[] = [];
const read = () => {
  const p = pending<unknown>();
  reads.push(p);
  return p.promise;
};
let toolsChanged = () => undefined as void;
vi.mock('wxt/browser', () => ({ browser: { commands: { getAll: read } } }));
vi.mock('../src/core/runtime', () => ({
  sendRuntime: read,
  onRuntime: (_type: string, f: () => void) => ((toolsChanged = f), () => undefined),
}));
vi.mock('../src/tools/custom/store', () => ({ customToolStore: { onChanged: () => () => undefined } }));
const { useShortcuts } = await import('../src/ui/shortcuts');
const { useToolCatalog } = await import('../src/ui/Tools');

describe('a value read again', () => {
  it('keeps the latest read of the shortcuts', async () => {
    reads.length = 0;
    let shown: { shortcut: string }[] = [];
    const Probe = () => ((shown = useShortcuts()), null);
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
    act(() => void document.dispatchEvent(new Event('visibilitychange')));
    expect(reads).toHaveLength(2);
    await act(async () => reads[1]!.resolve([{ name: 'a', shortcut: 'Alt+N' }]));
    await act(async () => reads[0]!.resolve([{ name: 'a', shortcut: 'Alt+O' }]));
    expect(shown.map((s) => s.shortcut)).toEqual(['Alt+N']);
    act(() => root.unmount());
  });

  it('keeps the latest read of the tool catalog', async () => {
    reads.length = 0;
    let shown: { name: string }[] = [];
    const Probe = () => ((shown = useToolCatalog()), null);
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
    act(() => toolsChanged());
    expect(reads).toHaveLength(2);
    await act(async () => reads[1]!.resolve({ tools: [{ name: 'new' }] }));
    await act(async () => reads[0]!.resolve({ tools: [{ name: 'old' }] }));
    expect(shown.map((t) => t.name)).toEqual(['new']);
    act(() => root.unmount());
  });
});
