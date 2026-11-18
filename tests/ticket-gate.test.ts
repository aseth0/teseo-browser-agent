// @vitest-environment jsdom
// Where the chat app starts (entrypoints/sidepanel/ticket-gate): floating.html, the only page a web page
// can load, only in a web page's frame once the background redeemed its ticket (never in a tab of its own,
// never with no ticket or a refused one: nothing of the chat loads); sidepanel.html anywhere but in a
// web page's frame.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sendMessage = vi.fn();
vi.mock('wxt/browser', () => ({ browser: { runtime: { sendMessage } } }));
const loaded = vi.hoisted(() => ({ count: 0 }));
vi.mock('../src/entrypoints/sidepanel/chat-main', () => {
  loaded.count++;
  return {};
});

const { FRAME_REDEEM } = await import('../src/widget/protocol');
const { mayFloat, startChat, startFloating, startPanel, ticketOf } = await import('../src/entrypoints/sidepanel/ticket-gate');

const TICKET = 'a'.repeat(64);
const redeem = vi.fn(async (_ticket: string): Promise<{ shown: boolean } | undefined> => ({ shown: true }));

beforeEach(() => {
  redeem.mockClear();
  sendMessage.mockReset();
  loaded.count = 0;
  location.hash = '';
});

// This window framed by a web page (its parent's location denied, its ancestors listed), for `run`.
async function framedByAPage<T>(run: () => Promise<T>): Promise<T> {
  const top = Object.getOwnPropertyDescriptor(window, 'top');
  const parent = Object.getOwnPropertyDescriptor(window, 'parent');
  Object.defineProperty(window, 'top', { configurable: true, get: () => ({}) });
  Object.defineProperty(window, 'parent', { configurable: true, get: () => ({ get location() { throw new DOMException('Blocked a frame', 'SecurityError'); } }) });
  Object.defineProperty(window.location, 'ancestorOrigins', { configurable: true, value: ['https://example.com'] });
  try {
    return await run();
  } finally {
    // Back as they were: their own properties again, or none (the window's own getters, further down).
    for (const [name, was] of [['top', top], ['parent', parent]] as const) {
      if (was) Object.defineProperty(window, name, was);
      else delete (window as unknown as Record<string, unknown>)[name];
    }
    delete (window.location as { ancestorOrigins?: unknown }).ancestorOrigins;
  }
  expect(window.top).toBe(window);
}

// A page's module loaded afresh, and given a moment to start (or not).
async function loadPage(page: 'floating' | 'sidepanel') {
  vi.resetModules();
  // Mocked anew: a mock's module is kept across resetModules, and counted only the first time.
  vi.doMock('../src/entrypoints/sidepanel/chat-main', () => {
    loaded.count++;
    return {};
  });
  await import(page === 'floating' ? '../src/entrypoints/floating/main' : '../src/entrypoints/sidepanel/main');
  await new Promise((r) => setTimeout(r, 20));
}

describe('the ticket in the URL', () => {
  it('is read from the fragment', () => {
    expect(ticketOf(`#ticket=${TICKET}`)).toBe(TICKET);
    expect(ticketOf('')).toBeUndefined();
    expect(ticketOf('#ticket=')).toBeUndefined();
    expect(ticketOf('#other=1')).toBeUndefined();
  });
});

describe('mayFloat', () => {
  it("never in a tab's top document, whatever its fragment: the background is not even asked", async () => {
    expect(await mayFloat(false, `#ticket=${TICKET}`, redeem)).toBe(false);
    expect(await mayFloat(false, '', redeem)).toBe(false);
    expect(redeem).not.toHaveBeenCalled();
  });

  it('framed by a page with no ticket: nothing, and the background is not even asked', async () => {
    expect(await mayFloat(true, '', redeem)).toBe(false);
    expect(await mayFloat(true, '#ticket=', redeem)).toBe(false);
    expect(redeem).not.toHaveBeenCalled();
  });

  it('framed by a page: as the background says of its ticket', async () => {
    expect(await mayFloat(true, `#ticket=${TICKET}`, redeem)).toBe(true);
    expect(redeem).toHaveBeenCalledWith(TICKET);
    redeem.mockResolvedValueOnce({ shown: false });
    expect(await mayFloat(true, '#ticket=made-up', redeem)).toBe(false);
    redeem.mockResolvedValueOnce(undefined); // nobody answered
    expect(await mayFloat(true, `#ticket=${TICKET}`, redeem)).toBe(false);
    redeem.mockRejectedValueOnce(new Error('Could not establish connection'));
    expect(await mayFloat(true, `#ticket=${TICKET}`, redeem)).toBe(false);
    redeem.mockImplementationOnce(() => { throw new TypeError("can't access property \"sendMessage\", runtime is undefined"); }); // Firefox's framed page
    expect(await mayFloat(true, `#ticket=${TICKET}`, redeem)).toBe(false);
  });
});

describe('startChat', () => {
  it('loads the chat only once it may show', async () => {
    const load = vi.fn(async () => undefined);
    expect(await startChat(load, async () => false)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(await startChat(load, async () => true)).toBe(true);
    expect(load).toHaveBeenCalledOnce();
  });

  it("floating: asks the background to redeem the ticket of a page's frame", async () => {
    await framedByAPage(async () => {
      const load = vi.fn(async () => undefined);
      location.hash = `#ticket=${TICKET}`;
      sendMessage.mockResolvedValueOnce({ shown: false });
      expect(await startFloating(load)).toBe(false);
      expect(sendMessage).toHaveBeenCalledWith({ type: FRAME_REDEEM, ticket: TICKET });
      sendMessage.mockResolvedValueOnce({ shown: true });
      expect(await startFloating(load)).toBe(true);
      expect(load).toHaveBeenCalledOnce();
      location.hash = '';
      sendMessage.mockClear();
      expect(await startFloating(load)).toBe(false);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });

  it('the panel: anywhere but in a web page\'s frame, asking nothing', async () => {
    const load = vi.fn(async () => undefined);
    expect(await startPanel(load, () => true)).toBe(false);
    expect(load).not.toHaveBeenCalled();
    expect(await startPanel(load, () => false)).toBe(true);
    expect(load).toHaveBeenCalledOnce();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe('floating.html', () => {
  it('opened in a tab of its own, even with a ticket, imports nothing of the chat and asks nothing', async () => {
    location.hash = `#ticket=${TICKET}`;
    sendMessage.mockResolvedValue({ shown: true });
    await loadPage('floating');
    expect(loaded.count).toBe(0);
    expect(sendMessage).not.toHaveBeenCalled();
    expect(document.getElementById('root')?.childElementCount ?? 0).toBe(0);
  });

  it('framed by a page with no ticket, or a made-up one, imports nothing of the chat', async () => {
    await framedByAPage(async () => {
      for (const hash of ['', '#ticket=made-up', `#ticket=${'0'.repeat(64)}`]) {
        location.hash = hash;
        sendMessage.mockResolvedValue({ shown: false });
        await loadPage('floating');
        expect(loaded.count).toBe(0);
        expect(document.getElementById('root')?.childElementCount ?? 0).toBe(0);
      }
    });
  });

  it('framed by a page with the ticket the background redeems, starts the chat', async () => {
    await framedByAPage(async () => {
      location.hash = `#ticket=${TICKET}`;
      sendMessage.mockResolvedValue({ shown: true });
      await loadPage('floating');
      await vi.waitFor(() => expect(loaded.count).toBe(1));
      expect(sendMessage).toHaveBeenCalledWith({ type: FRAME_REDEEM, ticket: TICKET });
    });
  });
});

describe('sidepanel.html', () => {
  it('not framed by a page, loads the chat at once, asking nothing', async () => {
    await loadPage('sidepanel');
    await vi.waitFor(() => expect(loaded.count).toBe(1));
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('framed by a web page, even with a ticket, imports nothing of the chat and asks nothing', async () => {
    await framedByAPage(async () => {
      location.hash = `#ticket=${TICKET}`;
      sendMessage.mockResolvedValue({ shown: true });
      await loadPage('sidepanel');
      expect(loaded.count).toBe(0);
      expect(sendMessage).not.toHaveBeenCalled();
    });
  });
});
