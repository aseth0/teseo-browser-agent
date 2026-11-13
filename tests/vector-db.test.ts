// The vectors' own database (memory/vector-db): never the secrets' one, whose version older builds open.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', () => ({ browser: { runtime: { getURL: (p: string) => `chrome-extension://ext-id${p}` } } }));
const { deleteVectors, readVectors, VECTOR_DB, writeVectors } = await import('../src/memory/vector-db');

afterEach(() => vi.unstubAllGlobals());

describe('the vectors database', () => {
  it('is not the database of the secrets', () => {
    expect(VECTOR_DB).toBe('browser-agent-vectors');
  });

  it("refuses to be used outside the extension's origin", async () => {
    vi.stubGlobal('location', { origin: 'https://shop.example.com' });
    const open = vi.fn();
    vi.stubGlobal('indexedDB', { open });
    await expect(readVectors()).rejects.toThrow("extension's own pages");
    await expect(writeVectors([])).rejects.toThrow("extension's own pages");
    await expect(deleteVectors([])).rejects.toThrow("extension's own pages");
    expect(open).not.toHaveBeenCalled();
  });
});
