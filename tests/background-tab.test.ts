// Background tabs open in the agent's window, never focused, and those opened at once in a window go
// to one "Agent" group, not one each.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser, fakeStorage } from './fakes/browser';

const groups: { id: number; title?: string; windowId: number; tabs: number[] }[] = [];
const created: { url: string; active: boolean; windowId?: number }[] = [];
const lastFocusedAsked: unknown[] = [];
const windowsCreated: unknown[] = [];
const removed: { tabs: number[]; windows: number[] } = { tabs: [], windows: [] };
let normalWindow = true; // whether any normal window is open (the last focused: 3)
let nextTab = 1;
const later = () => new Promise((r) => setTimeout(r, 5));
// The panel's tab 50 in a normal window (7); tab 60 in a PWA window (9) and 61 in a popup (10); the
// last focused normal window: 3.
const tabs: Record<number, { id: number; windowId: number }> = { 50: { id: 50, windowId: 7 }, 60: { id: 60, windowId: 9 }, 61: { id: 61, windowId: 10 } };
const windows: Record<number, { id: number; type: string }> = { 7: { id: 7, type: 'normal' }, 9: { id: 9, type: 'app' }, 10: { id: 10, type: 'popup' } };
const browser = fakeBrowser(fakeStorage(), {
  tabs: {
    create: async (props: { url: string; active: boolean; windowId?: number }) => {
      created.push(props);
      return { id: nextTab++, windowId: props.windowId ?? 1 };
    },
    get: async (id: number) => tabs[id] ?? Promise.reject(new Error(`No tab with id: ${id}.`)),
    update: async () => ({}),
    remove: async (id: number) => void removed.tabs.push(id),
    group: async ({ tabIds, groupId, createProperties }: { tabIds: number; groupId?: number; createProperties?: { windowId: number } }) => {
      await later();
      const group = groupId !== undefined ? groups.find((g) => g.id === groupId)! : { id: groups.length + 1, windowId: createProperties!.windowId, tabs: [] as number[] };
      if (groupId === undefined) groups.push(group);
      group.tabs.push(tabIds);
      return group.id;
    },
  },
  windows: {
    get: async (id: number) => windows[id] ?? Promise.reject(new Error(`No window with id: ${id}.`)),
    getLastFocused: async (query: unknown) => {
      lastFocusedAsked.push(query);
      return normalWindow ? { id: 3, type: 'normal' } : Promise.reject(new Error('No last-focused window'));
    },
    create: async (props: unknown) => {
      windowsCreated.push(props);
      return { id: 20, type: 'normal', tabs: [{ id: nextTab++, windowId: 20 }] };
    },
    remove: async (id: number) => void removed.windows.push(id),
  },
  tabGroups: {
    query: async ({ title, windowId }: { title: string; windowId: number }) => {
      await later();
      return groups.filter((g) => g.title === title && g.windowId === windowId);
    },
    update: async (id: number, { title }: { title: string }) => {
      await later();
      groups.find((g) => g.id === id)!.title = title;
    },
  },
});
vi.mock('wxt/browser', () => ({ browser }));
const { createBackgroundTab, inBackgroundTab, ownWindowIds } = await import('../src/page/background-tab');

describe('background tabs', () => {
  beforeEach(() => {
    groups.length = 0;
    created.length = 0;
    lastFocusedAsked.length = 0;
    windowsCreated.length = 0;
    removed.tabs.length = removed.windows.length = 0;
    normalWindow = true;
  });

  it('opened at once in a window, go to one group', async () => {
    const agentTab = 50;
    await Promise.all([createBackgroundTab('https://a.example.com/', { agentTab }), createBackgroundTab('https://b.example.com/', { agentTab }), createBackgroundTab('https://c.example.com/', { agentTab })]);
    expect(groups).toEqual([{ id: 1, title: 'Agent', windowId: 7, tabs: [1, 2, 3] }]);
  });

  it("open in the window of the agent's tab, unfocused", async () => {
    await createBackgroundTab('https://a.example.com/', { agentTab: 50 });
    expect(created).toEqual([{ url: 'https://a.example.com/', active: false, windowId: 7 }]);
    expect(lastFocusedAsked).toEqual([]);
  });

  it('without a tab of its own, or one in an app or popup window, open in the last focused normal window', async () => {
    await createBackgroundTab('https://a.example.com/');
    await createBackgroundTab('https://b.example.com/', { agentTab: 60 }); // a PWA window cannot hold it
    await createBackgroundTab('https://c.example.com/', { agentTab: 61 }); // nor a popup
    await createBackgroundTab('https://d.example.com/', { agentTab: 99 }); // closed meanwhile
    expect(created.map((c) => c.windowId)).toEqual([3, 3, 3, 3]);
    expect(lastFocusedAsked).toEqual(Array(4).fill({ windowTypes: ['normal'] }));
    expect(windowsCreated).toEqual([]);
  });

  it('without any normal window, open in one of their own, minimized and unfocused, closed with them', async () => {
    normalWindow = false;
    await inBackgroundTab('https://a.example.com/', { agentTab: 60 }, async () => expect(await ownWindowIds()).toEqual([20]));
    expect(await ownWindowIds()).toEqual([]);
    expect(created).toEqual([]);
    expect(windowsCreated).toEqual([{ url: 'https://a.example.com/', type: 'normal', state: 'minimized', focused: false }]);
    expect(removed).toEqual({ tabs: [], windows: [20] });
    // A tab in a normal window is closed alone.
    normalWindow = true;
    await inBackgroundTab('https://b.example.com/', {}, async () => undefined);
    expect(removed.windows).toEqual([20]);
    expect(removed.tabs).toHaveLength(1);
  });
});
