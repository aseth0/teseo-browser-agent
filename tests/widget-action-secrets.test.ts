// What gives a page action its reach (its tool and arguments, where and when it runs, its prompt, its
// agent, whether it opens the chat) and whether it is on are kept apart from storage.local.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';
import type { WidgetAction } from '../src/widget/actions';

const storage = fakeStorage();
const local = storage.local.data;
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fakeBrowser(storage) }));
const { actionStore } = await import('../src/widget/store');

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});

const action: WidgetAction = {
  id: 'a', enabled: true, name: 'Look up', where: ['https://shop.test/*'], input: 'selection', tool: 'wiki.search', args: { q: '{input}' }, outputs: [{ label: 'Result' }],
};
const storedActions = () => (local.pageActions as { user: WidgetAction[] }).user;

describe("a page action's reach", () => {
  it('is kept apart; storage.local keeps the action whole, for earlier versions', async () => {
    await actionStore.save(action);
    expect(storedActions()[0]).toEqual(action);
    expect((await actionStore.load())[0]).toEqual(action);
  });

  it('is gone, and the action off, once a page changes it in storage.local or writes one of its own', async () => {
    await actionStore.save(action);
    await actionStore.load(); // the move, once
    const planted: WidgetAction = { ...action, id: 'planted', when: 'load', where: ['https://evil.test/*'], tool: 'history.search' };
    local.pageActions = { user: [{ ...action, where: ['https://evil.test/*'], args: { q: 'secrets' } }, planted], disabledBuiltins: [] };
    const [changed, theirs] = await actionStore.load();
    expect(changed).toMatchObject({ enabled: false, where: ['https://evil.test/*'] });
    expect(theirs).toMatchObject({ enabled: false, when: 'load' });
  });

  it('stays its own when only its name changes, or its keys come in another order', async () => {
    await actionStore.save({ ...action, args: { q: '{input}', lang: 'en' } });
    local.pageActions = { user: [{ ...storedActions()[0]!, name: 'Renamed', args: { lang: 'en', q: '{input}' } }], disabledBuiltins: [] };
    expect((await actionStore.load())[0]).toMatchObject({ enabled: true, name: 'Renamed' });
  });

  it('kept only in storage.local by earlier versions, is moved once', async () => {
    local.pageActions = { user: [action], disabledBuiltins: [] };
    expect((await actionStore.load())[0]).toEqual(action);
    local.pageActions = { user: [action, { ...action, id: 'later' }], disabledBuiltins: [] };
    expect((await actionStore.load()).map((a) => a.enabled)).toEqual([true, false]);
  });
});
