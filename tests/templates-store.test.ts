// The stored page templates (templates/store), as a build from before views shares them.
import { describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));

const { templateStore } = await import('../src/templates/store');
const { newTemplate } = await import('../src/templates/types');

describe('templateStore', () => {
  it('keeps the body of a template saved before views for earlier versions, when another one is saved', async () => {
    const old = { id: 'o', name: 'old', description: '', matches: ['*://x.test/*'], body: 'B', replacePage: true, enabled: true };
    storage.local.data.templates = { user: [old], disabledBuiltins: [] };
    await templateStore.save({ ...newTemplate(), id: 'n', name: 'new' });
    const [stored] = (storage.local.data.templates as { user: Record<string, unknown>[] }).user;
    expect(stored).toMatchObject({ body: 'B', replacePage: true, views: [{ name: 'main', body: 'B', replacePage: true }] });
    expect((await templateStore.load()).find((t) => t.id === 'o')!.views).toEqual([{ name: 'main', paths: ['*'], replacePage: true, body: 'B' }]);
  });
});
