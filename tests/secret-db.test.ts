// The extension's own database opens only in its own pages and worker: in a content script, indexedDB
// is the page's, so it is never opened there (storage/secret-db, run as it is, not mocked).
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (p: string) => `chrome-extension://ext-id${p}` } } }));
const { dbGet, dbSet } = await import('../src/storage/secret-db');

afterEach(() => vi.unstubAllGlobals());

describe('the secrets database', () => {
  it('refuses to be read or written outside the extension\'s origin', async () => {
    vi.stubGlobal('location', { origin: 'https://shop.example.com' });
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    await expect(dbGet('settings')).rejects.toThrow("extension's own pages");
    await expect(dbSet('settings', {})).rejects.toThrow("extension's own pages");
    expect(open).not.toHaveBeenCalled();
  });
});
