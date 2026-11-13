// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// Leaving the template editor before its preview page has opened: the background tab is closed once
// it opens, not left open for good.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let opened!: (id: number) => void;
const closed: number[] = [];
vi.mock('wxt/browser', () => ({ browser: {} }));
vi.mock('../src/templates/run', () => ({ runPageTemplate: async () => null }));
vi.mock('../src/ui/sample-page', () => ({
  openBackgroundTab: () => new Promise<number>((r) => (opened = r)),
  closeTab: async (id: number) => void closed.push(id),
}));
vi.mock('../src/ui/settings-context', () => ({ useSettingsContext: () => ({ settings: {} }) }));
const { useTemplatePreviewTab } = await import('../src/ui/templates/useTemplatePreviewTab');

describe('the template preview tab', () => {
  it('is closed when it opens after the editor is gone', async () => {
    let preview!: ReturnType<typeof useTemplatePreviewTab>;
    const Probe = () => ((preview = useTemplatePreviewTab({ views: [] } as never, '')), null);
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe)));
    let loading!: Promise<void>;
    act(() => void (loading = preview.load()));
    act(() => root.unmount());
    await act(async () => {
      opened(7);
      await loading;
    });
    expect(closed).toEqual([7]);
  });
});
