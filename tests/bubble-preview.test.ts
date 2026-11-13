// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { bubbleKey } from '../src/ui/bubble/BubblePreview';
import { useDraft } from '../src/ui/useDraft';

// Settings → Bubble: the preview is drawn again only when the bubble's own fields change, and the
// SVG pasted follows a change from elsewhere until it is edited.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('the bubble preview', () => {
  it('is drawn for the bubble fields alone, in any order', () => {
    const look = { bubbleFace: 'shape', bubbleShape: 'ghost', bubbleColor: '#123456' } as const;
    expect(bubbleKey({ ...look, mode: 'dark', accent: '#ff0000' })).toBe(bubbleKey(look));
    expect(bubbleKey({ bubbleColor: '#123456', bubbleShape: 'ghost', bubbleFace: 'shape' })).toBe(bubbleKey(look));
    expect(bubbleKey({ ...look, bubbleHat: undefined })).toBe(bubbleKey(look));
    expect(bubbleKey({ ...look, bubbleShape: 'orb' })).not.toBe(bubbleKey(look));
  });
});

describe('useDraft', () => {
  let field: ReturnType<typeof useDraft>;
  function Probe({ saved }: { saved: string }) {
    field = useDraft(saved);
    return null;
  }

  it('follows the saved value until edited, then keeps what was typed', () => {
    const root = createRoot(document.createElement('div'));
    act(() => root.render(createElement(Probe, { saved: '<svg a/>' })));
    expect(field[0]).toBe('<svg a/>');
    act(() => root.render(createElement(Probe, { saved: '<svg b/>' }))); // e.g. a theme imported
    expect(field[0]).toBe('<svg b/>');
    act(() => field[1]('<svg typed/>'));
    act(() => root.render(createElement(Probe, { saved: '<svg c/>' })));
    expect(field[0]).toBe('<svg typed/>');
    // Kept (the draft saved as it is): it follows again from there.
    act(() => root.render(createElement(Probe, { saved: '<svg typed/>' })));
    act(() => root.render(createElement(Probe, { saved: '' })));
    expect(field[0]).toBe('');
    act(() => root.unmount());
  });
});
