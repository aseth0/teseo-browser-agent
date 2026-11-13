// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// The side panel takes the screenshots meant for it: when it opens, or while it is open.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let stored: unknown;
const remove = vi.fn(async () => void (stored = undefined));
let changed: () => void = () => undefined;
vi.mock('wxt/browser', () => ({ browser: { storage: { session: { remove } } } }));
vi.mock('../src/storage/area', () => ({ storageGet: async () => stored }));
vi.mock('../src/storage/watch', () => ({ watchKey: (_a: string, _k: string, f: () => void) => ((changed = f), () => undefined) }));
const frame = { FLOATING: false, MANAGER: false, FULL: false, PREVIEW: false, floatingTab: async () => undefined };
vi.mock('../src/ui/floating-frame', () => frame);
vi.mock('../src/entrypoints/sidepanel/usePageTarget', () => ({ PANEL_TAB: undefined }));
const { useHandoff } = await import('../src/entrypoints/sidepanel/useHandoff');
const { HANDOFF_MS } = await import('../src/core/handoff');
const { CHAT_ATTACH, isImagesPayload } = await import('../src/capture/protocol');

const attach = (extra = {}, to = {}) => ({ at: Date.now(), payload: { kind: 'images', images: [{ mediaType: 'image/jpeg', data: 'x' }], ...extra }, ...to });
type Take = Parameters<typeof useHandoff>[3];
const useCaptureHandoff = (take: Take, hook = useHandoff) => hook(CHAT_ATTACH, isImagesPayload, { waitMs: HANDOFF_MS, tag: 'capture-handoff' }, take);

describe('useHandoff, for the images handed to the chat', () => {
  it("takes one for the window's panel on mount and while open, and leaves another chat's", async () => {
    const take = vi.fn();
    stored = attach();
    const Probe = () => (useCaptureHandoff(take), null);
    await act(async () => createRoot(document.createElement('div')).render(createElement(Probe)));
    await vi.waitFor(() => expect(take).toHaveBeenCalledTimes(1));
    expect(remove).toHaveBeenCalledWith(CHAT_ATTACH);
    stored = attach({}, { tab: 3 }); // the chat floating on tab 3's
    await act(async () => changed());
    stored = attach({ note: 'Could not capture the page (denied).' });
    await act(async () => changed());
    await vi.waitFor(() => expect(take).toHaveBeenCalledTimes(2));
    expect(take.mock.calls[1]![0]).toMatchObject({ payload: { note: 'Could not capture the page (denied).' } });
  });
});

describe('useHandoff in Settings → Appearance', () => {
  it("the preview chat never takes the side panel's", async () => {
    vi.resetModules();
    frame.PREVIEW = true;
    const { useHandoff: inPreview } = await import('../src/entrypoints/sidepanel/useHandoff');
    const take = vi.fn();
    remove.mockClear();
    stored = attach();
    const Probe = () => (useCaptureHandoff(take, inPreview), null);
    await act(async () => createRoot(document.createElement('div')).render(createElement(Probe)));
    await new Promise((r) => setTimeout(r, 20));
    expect(take).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
