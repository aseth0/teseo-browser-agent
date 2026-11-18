// @vitest-environment jsdom
// Whether the chat's page is framed by a web page (the gates of entrypoints/sidepanel/ticket-gate), and
// which chat it is: floating only as floating.html, never as sidepanel.html, whatever its query says.
import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { tabs: { getCurrent: async () => undefined } } }));
const { framedByPage } = await import('../src/ui/framed-by-page');

// ui/floating-frame loaded afresh at that URL.
async function chatAt(url: string) {
  const { pathname, search } = new URL(url);
  vi.stubGlobal('location', { pathname, search });
  vi.resetModules();
  try {
    return await import('../src/ui/floating-frame');
  } finally {
    vi.unstubAllGlobals();
  }
}

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

describe('FLOATING', () => {
  it('is floating.html, the page in the widget\'s frame', async () => {
    expect((await chatAt(`${EXTENSION}/floating.html#ticket=x`)).FLOATING).toBe(true);
  });

  it('is never sidepanel.html, even with the query that used to say so', async () => {
    for (const query of ['', '?floating', '?full', '?tab=3', '?tab=3&manager', '?preview']) expect((await chatAt(`${EXTENSION}/sidepanel.html${query}`)).FLOATING).toBe(false);
  });
});
