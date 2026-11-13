import { beforeEach, describe, expect, it, vi } from 'vitest';

interface Node { id: string; title: string; url?: string; dateAdded?: number; parentId?: string; folderType?: string; children?: Node[] }

// The browser's tree: its root, the bookmarks bar and "Other bookmarks".
let tree: Node;
let allowed = true;
const find = (id: string, n: Node = tree): Node | undefined => (n.id === id ? n : n.children?.map((c) => find(id, c)).find(Boolean));
let next = 100;

vi.mock('wxt/browser', () => ({
  browser: {
    permissions: { contains: async () => allowed },
    bookmarks: {
      getTree: async () => [tree],
      getSubTree: async (id: string) => (find(id) ? [find(id)] : Promise.reject(new Error('not found'))),
      get: async (id: string) => (find(id) ? [find(id)] : Promise.reject(new Error("Can't find bookmark for id."))),
      create: async (b: { parentId: string; title: string; url?: string }) => {
        const made = { id: String(next++), title: b.title, url: b.url, dateAdded: 5, parentId: b.parentId, ...(b.url ? {} : { children: [] }) };
        find(b.parentId)!.children!.push(made);
        return made;
      },
      remove: async (id: string) => {
        const walk = (n: Node) => {
          n.children = n.children?.filter((c) => c.id !== id);
          n.children?.forEach(walk);
        };
        walk(tree);
      },
    },
  },
}));

const { allBookmarks, bookmarkUrl, everyFolder, bookmarkSlugs, folderContents, saveBookmark, searchBookmarks, deleteBookmark } = await import('../src/bookmarks/store');
const { bookmarkMentionItems } = await import('../src/bookmarks/mention');
const { bookmarkAutoItems } = await import('../src/bookmarks/auto');
const { bookmarkAutoOf, bookmarkAutoSource } = await import('../src/context/sources');
const { webUrlOf } = await import('../src/ui/chat/turns');

beforeEach(() => {
  allowed = true;
  tree = {
    id: '0', title: '', children: [
      { id: '1', title: 'Bookmarks bar', folderType: 'bookmarks-bar', children: [{ id: '10', title: 'News', url: 'https://news.example.com/', dateAdded: 1 }] },
      {
        id: '2', title: 'Other bookmarks', folderType: 'other', children: [
          {
            id: '20', title: 'Agent', children: [
              { id: '21', title: 'Cheap cables', url: 'https://shop.example.com/cables', dateAdded: 2 },
              { id: '22', title: 'Recipes', children: [{ id: '23', title: 'Lemon pie', url: 'https://food.example.com/lemon-pie', dateAdded: 3 }] },
            ],
          },
        ],
      },
      // Added by the browser besides its own (Vivaldi's Trash): never seen.
      { id: '3', title: 'Trash', children: [{ id: '30', title: 'Gone', url: 'https://gone.example.com/', dateAdded: 4 }] },
    ],
  };
});

const all = {} as never;
const inAgent = { bookmarks: { rootId: '20' } } as never;

describe('bookmarks', () => {
  it('sees every bookmark without a folder, and only those inside it with one', async () => {
    expect((await allBookmarks(all)).filter((b) => b.url).map((b) => b.id)).toEqual(['10', '21', '23']);
    const inside = await allBookmarks(inAgent);
    expect(inside.map((b) => [b.id, b.path])).toEqual([['21', ''], ['22', ''], ['23', 'Recipes']]);
  });

  it('leaves out the top folders the browser adds besides its own (a trash)', async () => {
    expect((await allBookmarks(all)).map((b) => b.id)).not.toContain('30');
    expect((await everyFolder()).map((f) => [f.title, f.depth])).toEqual([['Bookmarks bar', 0], ['Other bookmarks', 0], ['Agent', 1], ['Recipes', 2]]);
    expect(await searchBookmarks(all, 'gone', 5)).toEqual([]);
  });

  it('searches by title and URL, inside the folder', async () => {
    expect((await searchBookmarks(inAgent, 'lemon', 5)).map((b) => b.id)).toEqual(['23']);
    expect((await searchBookmarks(inAgent, 'cables', 5)).map((b) => b.id)).toEqual(['21']);
    expect(await searchBookmarks(inAgent, 'news', 5)).toEqual([]); // outside the folder
    expect((await searchBookmarks(inAgent, 'lem', 5)).map((b) => b.id)).toEqual(['23']); // a search finds the words a word begins
  });

  it('lists a folder, and refuses one outside the root', async () => {
    expect((await folderContents(inAgent)).items.map((b) => b.title)).toEqual(['Cheap cables', 'Recipes']);
    expect(await folderContents(inAgent, '22')).toMatchObject({ path: 'Recipes', items: [{ id: '23' }] });
    await expect(folderContents(inAgent, '1')).rejects.toThrow('No folder with id 1');
  });

  it('saves into the root folder, or into Other bookmarks without one', async () => {
    expect(await saveBookmark(inAgent, { title: 'A', url: 'https://a.example.com/' })).toMatchObject({ path: '' });
    expect(find('20')!.children!.at(-1)!.title).toBe('A');
    expect(await saveBookmark(all, { title: 'B', url: 'https://b.example.com/' })).toMatchObject({ path: 'Other bookmarks' });
    await expect(saveBookmark(inAgent, { title: 'C', url: 'https://c.example.com/', folderId: '1' })).rejects.toThrow('No folder');
  });

  it('deletes only inside the root', async () => {
    await expect(deleteBookmark(inAgent, '10')).rejects.toThrow('No bookmark with id 10');
    expect(await deleteBookmark(inAgent, '21')).toMatchObject({ title: 'Cheap cables' });
    expect(find('21')).toBeUndefined();
  });

  it('says when the chosen folder is gone', async () => {
    await expect(allBookmarks({ bookmarks: { rootId: '99' } } as never)).rejects.toThrow('no longer exists');
  });

  it('attaches the bookmarks mentioned with b::, only when allowed', async () => {
    expect(bookmarkSlugs('see b::lemon-pie and b::cheap-cables, not ab::x')).toEqual(['lemon-pie', 'cheap-cables']);
    const items = await bookmarkMentionItems('see b::lemon-pie', inAgent);
    expect(items).toHaveLength(1);
    expect(items[0]!.text).toContain('https://food.example.com/lemon-pie');
    expect(items[0]!.text).toContain('/Recipes');
    allowed = false;
    expect(await bookmarkMentionItems('see b::lemon-pie', inAgent)).toEqual([]);
  });

  it('attaches on its own the bookmarks a message matches, once a chat, when on', async () => {
    const on = { bookmarks: { rootId: '20', autoAttach: { enabled: true, threshold: 60 } } } as never;
    expect(await bookmarkAutoItems('lemon pie', [], inAgent)).toEqual([]); // off by default
    const [item] = await bookmarkAutoItems('lemon pie', [], on);
    expect(item?.source).toMatch(/^bookmark-auto:23:\d+:u=https%3A%2F%2Ffood\.example\.com%2Flemon-pie:Lemon pie$/);
    expect(bookmarkAutoOf(item?.source)).toMatchObject({ id: '23', title: 'Lemon pie', url: 'https://food.example.com/lemon-pie' });
    expect(item?.text).toContain('attached automatically');
    expect(item?.text).toContain('https://food.example.com/lemon-pie');
    // Already attached in this chat, or mentioned: not again.
    const before = [{ role: 'user' as const, parts: [{ type: 'text' as const, text: item!.text, context: 'page' as const, source: item!.source }] }];
    expect(await bookmarkAutoItems('lemon pie again', before, on)).toEqual([]);
    expect(await bookmarkAutoItems('see b::lemon-pie', [], on)).toEqual([]);
    expect(await bookmarkAutoItems('cables', [], { bookmarks: { rootId: '20', autoAttach: { enabled: true, threshold: 100 } } } as never)).toHaveLength(1);
    // Whole words only, as memory and history: "lem" in a message is not "lemon".
    expect(await bookmarkAutoItems('lem', [], on)).toEqual([]);
    allowed = false;
    expect(await bookmarkAutoItems('lemon pie', [], on)).toEqual([]);
  });
});

describe('bookmarks.save', () => {
  it('refuses a URL that is not a web page before the user is asked', async () => {
    const { saveArgs } = await import('../src/bookmarks/tools');
    await expect(saveArgs({ url: 'javascript:alert(1)' }, undefined)).rejects.toThrow('Only web pages can be bookmarked');
    expect(await saveArgs({ url: 'https://example.com/a', title: 'A' }, undefined)).toEqual({ title: 'A', url: 'https://example.com/a', folderId: undefined });
  });

  it('keeps the address in the source for the chat, which links http(s) only', () => {
    // Colons in the title and the address survive; an older source has no address.
    expect(bookmarkAutoOf(bookmarkAutoSource('7', 80, 'A: b', 'https://x.example.com/a:b?c=1'))).toEqual({ id: '7', match: 80, title: 'A: b', url: 'https://x.example.com/a:b?c=1' });
    expect(bookmarkAutoOf('bookmark-auto:7:80:Old: title')).toEqual({ id: '7', match: 80, title: 'Old: title' });
    expect(webUrlOf('https://x.example.com/a')?.host).toBe('x.example.com');
    expect(webUrlOf('http://x.example.com/')).toBeDefined();
    for (const bad of ['javascript:alert(1)', 'JavaScript:alert(1)', 'file:///etc/hosts', 'data:text/html,x', 'chrome://settings', 'not a url', undefined]) expect(webUrlOf(bad)).toBeUndefined();
  });

  it("looks up an older bookmark's address by its id: none without the permission or once deleted", async () => {
    expect(await bookmarkUrl('23')).toBe('https://food.example.com/lemon-pie');
    expect(await bookmarkUrl('99')).toBeUndefined();
    allowed = false;
    expect(await bookmarkUrl('23')).toBeUndefined();
  });
});
