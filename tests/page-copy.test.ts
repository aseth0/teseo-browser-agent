// A copy of the page script left behind by a reload of the extension must not keep the new one out.
import { describe, expect, it, vi } from 'vitest';

let runtimeId: string | undefined = 'ext';
vi.mock('wxt/browser', () => ({
  browser: {
    get runtime() {
      return { id: runtimeId };
    },
  },
}));

const { contextAlive, takeOver } = await import('../src/content/page-copy');

describe('takeOver', () => {
  it('starts when no copy is here', () => {
    expect(takeOver(undefined)).toBe(true);
  });

  it('stays out when the copy here still hears its extension', () => {
    const retire = vi.fn();
    expect(takeOver({ alive: () => true, retire })).toBe(false);
    expect(retire).not.toHaveBeenCalled();
  });

  it('takes over from a copy cut off by a reload, which retires', () => {
    const retire = vi.fn();
    expect(takeOver({ alive: () => false, retire })).toBe(true);
    expect(retire).toHaveBeenCalledOnce();
  });

  it("takes over from an older build's mark", () => {
    expect(takeOver(true)).toBe(true);
  });
});

describe('contextAlive', () => {
  it('is false once the extension context is gone', () => {
    runtimeId = 'ext';
    expect(contextAlive()).toBe(true);
    runtimeId = undefined;
    expect(contextAlive()).toBe(false);
  });
});
