import { describe, expect, it, vi } from 'vitest';

const listeners = new Set<(changes: Record<string, unknown>, area: string) => void>();
const storage = { onChanged: { addListener: (l: (changes: Record<string, unknown>, area: string) => void) => listeners.add(l), removeListener: (l: (changes: Record<string, unknown>, area: string) => void) => listeners.delete(l) } };
const api: { storage?: typeof storage } = { storage };
vi.mock('wxt/browser', () => ({ browser: api }));
const { onStorageChanged, watchKey } = await import('../src/storage/watch');

const change = (changes: Record<string, unknown>, area: string) => listeners.forEach((l) => l(changes, area));

describe('watchKey', () => {
  it('calls back for its key in its areas, until unsubscribed', () => {
    const seen = vi.fn();
    const off = watchKey('local', 'k', seen);
    change({ k: { newValue: 1 } }, 'local');
    change({ other: { newValue: 2 } }, 'local');
    change({ k: { newValue: 3 } }, 'session');
    expect(seen.mock.calls).toEqual([[{ newValue: 1 }]]);
    off();
    change({ k: { newValue: 4 } }, 'local');
    expect(seen).toHaveBeenCalledOnce();
  });
});

describe('onStorageChanged', () => {
  it('unsubscribes without throwing in a copy cut off from the extension, which has no storage any more', () => {
    const off = onStorageChanged(() => undefined);
    delete api.storage;
    try {
      expect(off).not.toThrow();
    } finally {
      api.storage = storage;
    }
  });
});
