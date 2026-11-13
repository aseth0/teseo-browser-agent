// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeSecretDb, fakeStorage } from './fakes/browser';
import { buttonNamed, pageBrowser, pageGlobals, settle } from './fakes/panel';
import type { ManagerStatus } from '../src/manager/protocol';

// The Agents Panel's page (Manager): its rows come back from the last time, one is started on the tab
// chosen, each says what its chat tells it, and one is removed (asked first while its agent works).
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
pageGlobals();
const storage = fakeStorage();
const secrets = fakeSecretDb();
const fake = pageBrowser(storage, {
  tabs: [
    { id: 1, windowId: 1, url: 'https://shop.example.com/a', title: 'Shop', active: true },
    { id: 2, windowId: 1, url: 'https://mail.example.test/inbox', title: 'Mail' },
  ],
});
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({ browser: fake.browser }));

const { saveConversation } = await import('../src/history/store');
const { MANAGER_STATUS, MANAGER_STOP, MANAGER_STOPPED } = await import('../src/manager/protocol');
const { Manager } = await import('../src/entrypoints/manager/Manager');

let root: Root;
let box: HTMLElement;
async function open() {
  box = document.body.appendChild(document.createElement('div'));
  root = createRoot(box);
  await act(async () => root.render(createElement(Manager)));
  await settle(20);
}
const rows = () => [...box.querySelectorAll<HTMLElement>('[role="list"] [role="listitem"]')];
const frames = () => [...box.querySelectorAll<HTMLIFrameElement>('iframe.manager-frame')];
const button = (name: string, within: ParentNode = box) => buttonNamed(within, name);
// What a row's chat tells the page, from its own iframe.
const tell = (frame: HTMLIFrameElement, data: object) =>
  act(async () => void window.dispatchEvent(new MessageEvent('message', { data, origin: location.origin, source: frame.contentWindow })));
const status = (change: Partial<ManagerStatus>): ManagerStatus => ({ state: 'idle', said: false, conversationId: 'c', title: 'New conversation', step: 0, maxSteps: 15, agentName: 'Browser', model: 'm', given: 0, ...change });
async function start(tabTitle: string) {
  await act(async () => button('+ New agent')!.click());
  await settle();
  const dialog = box.querySelector('[role="dialog"]')!;
  const select = dialog.querySelector<HTMLSelectElement>('select')!;
  const option = [...select.options].find((o) => o.textContent!.startsWith(tabTitle))!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')!.set!.call(select, option.value);
    select.dispatchEvent(new Event('change', { bubbles: true }));
  });
  await act(async () => button('Start', dialog)!.click());
  await settle();
}

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
});
afterEach(() => {
  act(() => root.unmount());
  box.remove();
});

describe('the Agents Panel page', () => {
  it('starts empty, saying how to start one', async () => {
    await open();
    expect(rows()).toHaveLength(0);
    expect(box.textContent).toContain('No agents yet. Start one with + New agent.');
  });

  it('a new agent gets a row and a chat on the tab chosen, kept for next time once it said something', async () => {
    await open();
    await start('Mail');
    expect(rows()).toHaveLength(1);
    expect(frames()).toHaveLength(1);
    expect(new URL(frames()[0]!.src, location.href).searchParams.get('tab')).toBe('2');
    expect(box.querySelector('[role="dialog"]')).toBeNull();
    expect(storage.local.data.managerRows).toEqual([]);
    await tell(frames()[0]!, { type: MANAGER_STATUS, status: status({ said: true, conversationId: 'c1', title: 'Sort the inbox' }) });
    await settle();
    expect(storage.local.data.managerRows).toEqual([expect.objectContaining({ tabId: 2, conversationId: 'c1', title: 'Sort the inbox' })]);
  });

  it("a row says what its chat tells: working, then waiting for you, then done", async () => {
    await open();
    await start('Shop');
    const frame = frames()[0]!;
    await tell(frame, { type: MANAGER_STATUS, status: status({ state: 'working', title: 'Find a gift', url: 'https://shop.example.com/a', step: 2, turnStartedAt: Date.now(), lastTool: 'browser.find' }) });
    expect(rows()[0]!.textContent).toContain('Find a gift');
    expect(rows()[0]!.textContent).toContain('browser.find · 2/15');
    expect(rows()[0]!.textContent).toContain('shop.example.com');
    await tell(frame, { type: MANAGER_STATUS, status: status({ state: 'waiting', title: 'Find a gift' }) });
    expect(rows()[0]!.textContent).toContain('Waiting for you');
    await tell(frame, { type: MANAGER_STATUS, status: status({ state: 'idle', said: true, title: 'Find a gift' }) });
    expect(rows()[0]!.textContent).toContain('Done');
  });

  it('a message from a page that is not one of its chats changes nothing', async () => {
    await open();
    await start('Shop');
    await act(async () => void window.dispatchEvent(new MessageEvent('message', { data: { type: MANAGER_STATUS, status: status({ title: 'Forged' }) }, origin: location.origin, source: window })));
    await act(async () => void window.dispatchEvent(new MessageEvent('message', { data: { type: MANAGER_STATUS, status: status({ title: 'Forged' }) }, origin: 'https://evil.example.com', source: frames()[0]!.contentWindow })));
    expect(rows()[0]!.textContent).not.toContain('Forged');
  });

  it('an idle row is removed at once, with its chat', async () => {
    await open();
    await start('Shop');
    await act(async () => button('Remove', rows()[0]!)!.click());
    expect(rows()).toHaveLength(0);
    expect(frames()).toHaveLength(0);
  });

  it('a working row asks first, has its chat stop, and goes once the chat says it stopped', async () => {
    await open();
    await start('Shop');
    const frame = frames()[0]!;
    const toChat = vi.spyOn(frame.contentWindow!, 'postMessage');
    await tell(frame, { type: MANAGER_STATUS, status: status({ state: 'working', turnStartedAt: Date.now() }) });
    await act(async () => button('Remove', rows()[0]!)!.click());
    const ask = rows()[0]!.querySelector('[role="group"][aria-label="Stop this agent and remove it?"]')!;
    await act(async () => button('Remove', ask)!.click());
    expect(toChat).toHaveBeenCalledWith({ type: MANAGER_STOP }, location.origin);
    expect(rows()).toHaveLength(1);
    await tell(frame, { type: MANAGER_STOPPED });
    expect(rows()).toHaveLength(0);
  });

  it('rows of the last time come back stopped, those whose conversation is gone left out', async () => {
    await saveConversation({ id: 'kept', createdAt: 1, updatedAt: 1, history: [{ role: 'user', parts: [{ type: 'text', text: 'Track the parcel' }] }] });
    storage.local.data.managerRows = [
      { key: 'a', tabId: 1, conversationId: 'kept', title: 'Track the parcel', agentName: 'Browser', url: 'https://shop.example.com/a' },
      { key: 'b', tabId: 2, conversationId: 'deleted', title: 'Gone' },
    ];
    await open();
    expect(rows()).toHaveLength(1);
    expect(rows()[0]!.textContent).toContain('Track the parcel');
    expect(rows()[0]!.textContent).toContain('Stopped');
    expect(frames()).toHaveLength(0); // a stopped one has no chat until it goes on
    // Clicked, it goes on on its tab (still open on the same site).
    await act(async () => rows()[0]!.querySelector<HTMLButtonElement>('.manager-row-main')!.click());
    await settle();
    expect(frames()).toHaveLength(1);
    const url = new URL(frames()[0]!.src, location.href).searchParams;
    expect([url.get('tab'), url.get('conversation')]).toEqual(['1', 'kept']);
  });
});
