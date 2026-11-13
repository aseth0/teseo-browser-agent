// @vitest-environment jsdom
// The bubble's SVG fetched from a URL: the site's access is asked for that download only.
import { afterEach, describe, expect, it, vi } from 'vitest';

const granted = new Set<string>();
const permissions = {
  contains: vi.fn(async ({ origins }: { origins: string[] }) => origins.every((o) => granted.has(o))),
  request: vi.fn(async ({ origins }: { origins: string[] }) => (origins.forEach((o) => granted.add(o)), true)),
  remove: vi.fn(async ({ origins }: { origins: string[] }) => (origins.forEach((o) => granted.delete(o)), true)),
};
vi.mock('wxt/browser', () => ({ browser: { permissions } }));
const { fetchSvg } = await import('../src/ui/bubble-svg-fetch');
const { mockFetch } = await import('./fakes/browser');

const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>';
afterEach(() => {
  granted.clear();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("the bubble's SVG from a URL", () => {
  it('gives back the access to its site once fetched, when the site did not have it before', async () => {
    mockFetch(() => new Response(SVG));
    expect(await fetchSvg('https://img.example.com/logo.svg')).toMatchObject({ svg: expect.stringContaining('circle') });
    expect(granted.has('https://img.example.com/*')).toBe(false);
    // Also when the download fails.
    mockFetch(() => new Response('', { status: 500 }));
    expect(await fetchSvg('https://img.example.com/logo.svg')).toEqual({ error: "Couldn't fetch it: the server answered 500." });
    expect(permissions.remove).toHaveBeenCalledTimes(2);
  });

  it('asks for the site as a match pattern, without the port', async () => {
    mockFetch(() => new Response(SVG));
    await fetchSvg('https://img.example.com:8443/logo.svg');
    expect(permissions.request).toHaveBeenCalledWith({ origins: ['https://img.example.com/*'] });
    expect(permissions.remove).toHaveBeenCalledWith({ origins: ['https://img.example.com/*'] });
  });

  it('keeps an access the site already had', async () => {
    granted.add('https://img.example.com/*');
    mockFetch(() => new Response(SVG));
    await fetchSvg('https://img.example.com/logo.svg');
    expect(granted.has('https://img.example.com/*')).toBe(true);
    expect(permissions.remove).not.toHaveBeenCalled();
  });
});
