// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

// Images made smaller already (a screenshot from the popup) added to the message box as they are.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
vi.mock('wxt/browser', () => ({ browser: {} }));
vi.mock('../src/entrypoints/sidepanel/pdf', () => ({ isPdf: () => false, MAX_PDF: 1, readPdf: vi.fn() }));
const { useAttachments } = await import('../src/entrypoints/sidepanel/useAttachments');

type Attachments = ReturnType<typeof useAttachments>;
async function mount() {
  const got: { current?: Attachments } = {};
  const Probe = () => ((got.current = useAttachments()), null);
  await act(async () => createRoot(document.createElement('div')).render(createElement(Probe)));
  return got as { current: Attachments };
}
const img = (data: string) => ({ mediaType: 'image/jpeg', data });

describe('addImages', () => {
  it('adds them as they are, with the note given', async () => {
    const a = await mount();
    await act(async () => a.current.addImages([img('a')], 'Could not capture the page (denied).'));
    expect(a.current.images.map((i) => i.image)).toEqual([img('a')]);
    expect(a.current.note).toBe('Could not capture the page (denied).');
  });
  it('as many as a message takes (4): the rest left out, said', async () => {
    const a = await mount();
    await act(async () => a.current.addImages([img('a'), img('b'), img('c')]));
    await act(async () => a.current.addImages([img('d'), img('e'), img('f')], '2 parts of the page left out.'));
    expect(a.current.images.map((i) => i.image.data)).toEqual(['a', 'b', 'c', 'd']);
    expect(a.current.note).toBe('At most 4 images per message (Settings → Limits): 2 left out. 2 parts of the page left out.');
  });
});
