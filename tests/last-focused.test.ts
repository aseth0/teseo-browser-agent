// The last focused normal window: Chrome is asked for that type; Firefox ignores getLastFocused's
// windowTypes and logs an error for it, so there it is asked without and checked.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const asked: unknown[] = [];
let last: { id: number; type: string } | undefined;
const all = [{ id: 1, type: 'normal', focused: false }, { id: 2, type: 'normal', focused: false }];
const browser = fakeBrowser(fakeStorage(), {
  windows: {
    getLastFocused: async (info: unknown) => (asked.push(['last', info]), last ?? Promise.reject(new Error('No last-focused window'))),
    getAll: async (info: unknown) => (asked.push(['all', info]), all),
  },
});
vi.mock('wxt/browser', () => ({ browser }));
const { lastFocusedNormalWindow } = await import('../src/browser/last-focused');

afterEach(() => {
  asked.length = 0;
  vi.unstubAllGlobals();
});

describe('lastFocusedNormalWindow', () => {
  it('asks Chrome for a normal window', async () => {
    vi.stubGlobal('__FIREFOX__', false);
    last = { id: 3, type: 'normal' };
    expect(await lastFocusedNormalWindow({ populate: true })).toEqual(last);
    expect(asked).toEqual([['last', { populate: true, windowTypes: ['normal'] }]]);
  });

  it('asks Firefox without windowTypes', async () => {
    vi.stubGlobal('__FIREFOX__', true);
    last = { id: 3, type: 'normal' };
    expect(await lastFocusedNormalWindow()).toEqual(last);
    expect(asked).toEqual([['last', {}]]);
  });

  it('in Firefox, a popup focused last gives way to a normal window', async () => {
    vi.stubGlobal('__FIREFOX__', true);
    last = { id: 9, type: 'popup' };
    expect((await lastFocusedNormalWindow({ populate: true }))?.id).toBe(2);
    all[0]!.focused = true;
    expect((await lastFocusedNormalWindow())?.id).toBe(1);
    expect(asked).toContainEqual(['all', { populate: true, windowTypes: ['normal'] }]);
  });

  it('none when the browser has no last focused window', async () => {
    vi.stubGlobal('__FIREFOX__', true);
    last = undefined;
    expect(await lastFocusedNormalWindow()).toBeUndefined();
  });
});
