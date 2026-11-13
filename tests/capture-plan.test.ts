import { describe, expect, it } from 'vitest';
import { chatTarget, leftOutNote, pagePlan } from '../src/capture/plan';
import { captureKindOf, isChatAttach } from '../src/capture/protocol';

describe('pagePlan: a page cut into parts of a viewport each', () => {
  it('a page shorter than a part is one part', () => {
    expect(pagePlan(800, 1000, 4)).toEqual({ tops: [0], leftOut: 0 });
  });
  it('a part per viewport, the last one shorter', () => {
    expect(pagePlan(3500, 1000, 4)).toEqual({ tops: [0, 1000, 2000, 3000], leftOut: 0 });
  });
  it('as many as there is room for; the rest counted', () => {
    expect(pagePlan(6200, 1000, 4)).toEqual({ tops: [0, 1000, 2000, 3000], leftOut: 3 });
    expect(pagePlan(2000, 1000, 0)).toEqual({ tops: [], leftOut: 2 });
  });
});

describe('leftOutNote', () => {
  it('says how many parts were left out, and why', () => {
    expect(leftOutNote(1, 4)).toBe('1 part of the page left out: at most 4 images per message (Settings → Limits).');
    expect(leftOutNote(3, 4)).toBe('3 parts of the page left out: at most 4 images per message (Settings → Limits).');
  });
});

describe('chatTarget: which chat gets a capture', () => {
  it('the chat floating on the tab, no side panel opened', () => {
    expect(chatTarget(7, true, true)).toEqual({ panel: false, to: { tab: 7 } });
  });
  it("otherwise the window's side panel, or the tab's with the pin off", () => {
    expect(chatTarget(7, false, true)).toEqual({ panel: true, to: {} });
    expect(chatTarget(7, false, false)).toEqual({ panel: true, to: { panelTab: 7 } });
  });
  it('either side panel while the pin is not known yet', () => {
    expect(chatTarget(7, false, undefined)).toEqual({ panel: true, to: { panelTab: 7, anyPanel: true } });
    expect(chatTarget(7, true, undefined)).toEqual({ panel: false, to: { tab: 7 } });
  });
});

describe('captureKindOf', () => {
  it("a capture's shortcut, and no other", () => {
    expect(captureKindOf('capture-visible')).toBe('visible');
    expect(captureKindOf('capture-section')).toBe('section');
    expect(captureKindOf('capture-full-page')).toBe('full-page');
    expect(captureKindOf('float-chat')).toBeUndefined();
  });
});

describe('isChatAttach', () => {
  it('takes one as the extension writes it', () => {
    expect(isChatAttach({ at: 1, payload: { kind: 'images', images: [{ mediaType: 'image/jpeg', data: 'x' }] } })).toBe(true);
    expect(isChatAttach({ at: 1, payload: { kind: 'images', images: [], note: 'Could not capture the page (denied).' }, tab: 3 })).toBe(true);
    expect(isChatAttach({ at: 1, payload: { kind: 'images', images: [] }, panelTab: 3 })).toBe(true);
  });
  it('refuses anything else read from storage', () => {
    expect(isChatAttach(undefined)).toBe(false);
    expect(isChatAttach({ at: 1 })).toBe(false);
    expect(isChatAttach({ at: 1, images: [] })).toBe(false); // an older build's, flat
    expect(isChatAttach({ at: 1, payload: { kind: 'images', images: [{}] } })).toBe(false);
    expect(isChatAttach({ at: 1, payload: { kind: 'images', images: [] }, tab: '3' })).toBe(false);
    expect(isChatAttach({ at: 1, payload: { kind: 'images', images: [], note: 2 } })).toBe(false);
  });
});
