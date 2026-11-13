// @vitest-environment jsdom
// The side panel's page is the floating chat when its URL says so, and also whenever a page (not the
// extension) frames it: a page that embeds it never gets the side panel's UI.
import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: {} }));
const { framedByPage } = await import('../src/ui/floating-frame');

const EXTENSION = 'chrome-extension://ext-id';
const list = (origins: string[]) => Object.assign([...origins], { contains: (o: string) => origins.includes(o), item: (i: number) => origins[i] ?? null }) as unknown as DOMStringList;
// A window framed by `parent` (none: the top one), listing its ancestors or not.
function framed(parent: string | undefined, ancestors?: string[]) {
  const win: Record<string, unknown> = { location: { origin: EXTENSION, ...(ancestors && { ancestorOrigins: list(ancestors) }) } };
  win.top = parent === undefined ? win : {};
  win.parent = parent === undefined ? win : {
    get location() {
      if (parent !== EXTENSION) throw new DOMException('Blocked a frame', 'SecurityError');
      return { origin: parent };
    },
  };
  return win as unknown as Parameters<typeof framedByPage>[0];
}

describe('framedByPage', () => {
  it('is false at the top, and in frames of the extension\'s own pages', () => {
    expect(framedByPage(framed(undefined))).toBe(false);
    expect(framedByPage(framed(EXTENSION, [EXTENSION]))).toBe(false);
    expect(framedByPage(framed(EXTENSION))).toBe(false);
  });

  it('is true in a page\'s frame, or under one further up', () => {
    expect(framedByPage(framed('https://example.com', ['https://example.com']))).toBe(true);
    expect(framedByPage(framed(EXTENSION, [EXTENSION, 'https://example.com']))).toBe(true);
    expect(framedByPage(framed('https://example.com'))).toBe(true); // no ancestorOrigins (Firefox)
  });
});
