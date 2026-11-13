// @vitest-environment jsdom
// The Agents Panel answers its tools' asks (PANEL_START, PANEL_ROWS, PANEL_SEND) from the extension's
// own pages and the background only: a page's content script that knows a row's key gets nothing.
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeEvent } from './fakes/browser';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const EXTENSION = 'chrome-extension://ext-id/';
const onMessage = fakeEvent<(msg: unknown, sender: object, reply: (r: unknown) => void) => unknown>();
const create = vi.fn(async () => ({ id: 40 }));
vi.mock('wxt/browser', () => ({
  browser: {
    runtime: { onMessage, getURL: (path: string) => EXTENSION + path.replace(/^\//, '') },
    tabs: { create, get: vi.fn(async () => undefined) },
    storage: { local: { get: async () => ({}), set: async () => undefined }, session: { get: async () => ({}), set: async () => undefined }, onChanged: fakeEvent() },
  },
}));

const { PANEL_ROWS, PANEL_SEND, PANEL_START } = await import('../src/core/protocol');
const { usePanelRequests } = await import('../src/entrypoints/manager/usePanelRequests');

const ROWS = [
  { key: 'p1', tabId: 1, agentName: 'Builder' },
  { key: 'c1', tabId: 2, agentName: 'Helper', parent: 'p1' },
];
const BACKGROUND = { url: `${EXTENSION}background.js` };
const PAGE = { url: 'https://example.com/', tab: { id: 7 }, frameId: 0 };
const MESSAGE = { text: 'do it', shown: 'do it' };

let root: ReturnType<typeof createRoot>;
const dispatch = vi.fn();
beforeEach(async () => {
  vi.clearAllMocks();
  const Probe = () => (usePanelRequests(ROWS, dispatch, { current: new Map() }), null);
  root = createRoot(document.createElement('div'));
  await act(async () => root.render(createElement(Probe)));
});
afterEach(async () => {
  await act(async () => root.unmount());
});

// What a one-off message gets: its listeners' answer, or none.
const ask = async (msg: object, sender: object) => {
  const replies: unknown[] = [];
  const kept = onMessage.emit(msg, sender, (r) => replies.push(r));
  if (kept.includes(true)) await vi.waitFor(() => expect(replies.length).toBe(1));
  return replies[0];
};

describe('the Agents Panel tools, by sender', () => {
  it('a content script is not answered, and starts no tab nor gives any message', async () => {
    expect(await ask({ type: PANEL_ROWS, parent: 'p1' }, PAGE)).toBeUndefined();
    expect(await ask({ type: PANEL_START, parent: 'p1', agentName: 'X', message: MESSAGE, url: 'https://example.com/', max: 5 }, PAGE)).toBeUndefined();
    expect(await ask({ type: PANEL_SEND, parent: 'p1', row: 'c1', message: MESSAGE }, PAGE)).toBeUndefined();
    expect(create).not.toHaveBeenCalled();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('the background is answered', async () => {
    expect(await ask({ type: PANEL_ROWS, parent: 'p1' }, BACKGROUND)).toMatchObject({ rows: [{ row: 'c1' }] });
    expect(await ask({ type: PANEL_START, parent: 'p1', agentName: 'X', message: MESSAGE, url: 'https://example.com/', max: 5 }, BACKGROUND)).toHaveProperty('row');
    expect(create).toHaveBeenCalledOnce();
  });
});
