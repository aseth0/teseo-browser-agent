import { afterEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const db = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => db);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { SECRETS_REV, secretChanged, updateSecret } = await import('../src/storage/secrets');

afterEach(() => {
  storage.reset();
  db.data.clear();
});

// The storage.local changes the next writes make, as their listeners get them.
const changesOf = async (write: () => Promise<void>) => {
  const seen: Record<string, { oldValue?: unknown; newValue?: unknown }>[] = [];
  const listener = (c: (typeof seen)[number]) => void seen.push(c);
  storage.onChanged.addListener(listener);
  await write();
  storage.onChanged.removeListener(listener);
  return seen;
};

describe('secretChanged', () => {
  it('sees a change told here, but not as one from elsewhere', async () => {
    const [changes] = await changesOf(() => updateSecret('settings', () => ({ value: { k: 1 }, notify: true })));
    expect(secretChanged('settings', changes!)).toBe(true);
    expect(secretChanged('settings', changes!, { elsewhere: true })).toBe(false);
    expect(secretChanged('mcpAuth', changes!)).toBe(false); // another secret's stamp did not change
    expect(JSON.stringify(changes)).not.toContain('"k"');
  });

  it('sees a change another page or the worker made, as one from elsewhere', () => {
    const changes = { [SECRETS_REV]: { oldValue: { settings: 'a' }, newValue: { settings: 'b' } } };
    expect(secretChanged('settings', changes)).toBe(true);
    expect(secretChanged('settings', changes, { elsewhere: true })).toBe(true);
  });

  it('sees none without a new stamp', async () => {
    expect(secretChanged('settings', {})).toBe(false);
    expect(secretChanged('settings', { [SECRETS_REV]: { oldValue: { settings: 'a' }, newValue: { settings: 'a', mcpAuth: 'b' } } })).toBe(false);
    expect(await changesOf(() => updateSecret('settings', () => ({ value: { k: 2 }, notify: false })))).toEqual([]);
  });
});
