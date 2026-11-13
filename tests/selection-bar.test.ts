import { describe, expect, it } from 'vitest';
import { barWidth, besideActions, cardPlace, MAX_SHOWN, SPEAKER } from '../src/widget/selection-bar';
import type { WidgetActionInfo } from '../src/widget/protocol';

// The toolbar beside a selection: which of the page's actions it has, its width, and where a card goes.
const act = (id: string, more: Partial<WidgetActionInfo> = {}): WidgetActionInfo => ({ id, name: id, input: 'selection', besideSelection: true, ...more });

describe('the actions beside a selection', () => {
  it('those the background marked, in their order (it marks only those that may show there)', () => {
    const actions = [act('a'), act('b', { input: 'text' }), act('c', { besideSelection: undefined }), act('f', { openChat: true })];
    expect(besideActions(actions)).toEqual({ shown: [actions[0], actions[1], actions[3]], more: [] });
    expect(besideActions([])).toEqual({ shown: [], more: [] });
  });
  it(`${MAX_SHOWN} as buttons, in their order; the rest behind "…"`, () => {
    const actions = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => act(id));
    const { shown, more } = besideActions(actions);
    expect(shown.map((a) => a.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(more.map((a) => a.id)).toEqual(['e', 'f']);
    expect(besideActions(actions.slice(0, 4)).more).toEqual([]);
  });
});

describe('its width', () => {
  it('the speaker alone as always; a pill wider by a button per action', () => {
    expect(barWidth(true, 0)).toBe(SPEAKER);
    expect(barWidth(true, 1)).toBe(63);
    expect(barWidth(true, 5) - barWidth(true, 4)).toBe(24);
    expect(barWidth(false, 2)).toBe(54); // no speaker: no line either
  });
});

describe('where an action\'s card goes', () => {
  const view = { width: 1000, height: 800 };
  it('under the toolbar, from its left', () => {
    expect(cardPlace({ x: 100, y: 100, height: 26 }, view, 320)).toEqual({ left: 0, top: 32, width: 320, maxHeight: 660 });
  });
  it('moved left to stay inside the window, and narrower in a narrow one', () => {
    expect(cardPlace({ x: 900, y: 100, height: 26 }, view, 320).left).toBe(1000 - 8 - 320 - 900);
    expect(cardPlace({ x: 2, y: 100, height: 26 }, view, 320).left).toBe(6);
    expect(cardPlace({ x: 10, y: 100, height: 26 }, { width: 300, height: 800 }, 320)).toMatchObject({ left: -2, width: 284 });
  });
  it('over it near the window\'s bottom, as high as the room there', () => {
    expect(cardPlace({ x: 100, y: 700, height: 26 }, view, 320)).toEqual({ left: 0, bottom: 32, width: 320, maxHeight: 686 });
    // Enough room under it: under, even with more above.
    expect(cardPlace({ x: 100, y: 500, height: 26 }, view, 320)).toMatchObject({ top: 32, maxHeight: 260 });
  });
});
