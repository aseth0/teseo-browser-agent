// The browser's bookmarks, as the model and the panel see them: only once the user allows them
// (an optional permission, Settings → Bookmarks), and only those inside the folder chosen there (all
// of them when none is). Folders are named by their path from that folder ("Recipes/Desserts").
import { browser } from 'wxt/browser';
import { slugOf, slugsAfter } from '../core/sources';
import { indexTexts, scored, type MatchOptions } from '../search/bm25';
import type { Settings } from '../storage/settings';
import { MATCH_THRESHOLD, type AttachDefaults } from '../storage/settings-types';

type Node = Browser.bookmarks.BookmarkTreeNode;

export const BOOKMARKS_PERMISSION: { permissions: ['bookmarks'] } = { permissions: ['bookmarks'] };
export const DEFAULT_FOLDER_TITLE = 'Teseo';
// How many of the best matches auto-attach and its playground look at.
export const BOOKMARK_CANDIDATES = 20;
// Settings → Bookmarks → Auto-attach (bookmarks/auto), when not set.
export const BOOKMARK_AUTO_DEFAULTS: AttachDefaults = { threshold: MATCH_THRESHOLD, max: 1, most: 3 };

export const bookmarksAllowed = (): Promise<boolean> => browser.permissions.contains(BOOKMARKS_PERMISSION).catch(() => false);

// A bookmark's address by its id (the chat links one attached before its source kept the address):
// none without the permission, or once it is deleted.
export async function bookmarkUrl(id: string): Promise<string | undefined> {
  if (!id || !(await bookmarksAllowed())) return undefined;
  const [found] = await browser.bookmarks.get(id).catch(() => []);
  return found?.url;
}

export interface Bookmark {
  id: string;
  title: string;
  url?: string; // none: a folder
  path: string; // of the folder it is in, from the root ("" at the root)
  dateAdded?: number;
}

const rootIdOf = (settings: Settings) => settings.bookmarks?.rootId;

// The top folders of the tree the extension uses: the browser's own (the bar, Other bookmarks, mobile),
// marked with their folderType; not one a browser adds besides (Vivaldi's Trash). A browser that marks
// none: all of them.
function topFolders(tree: Node): Node[] {
  const kids = tree.children ?? [];
  return kids.some((k) => k.folderType) ? kids.filter((k) => k.folderType) : kids;
}
// The browser's "Other bookmarks": where a bookmark goes with no folder chosen.
const otherFolder = (tree: Node): Node | undefined => {
  const kids = topFolders(tree);
  return kids.find((k) => k.folderType === 'other') ?? kids[1] ?? kids[0];
};
// The children a root shows: the whole tree's, only its top folders.
const childrenOf = (node: Node, isTree: boolean) => (isTree ? topFolders(node) : (node.children ?? []));

// The root: the folder chosen, or the whole tree. A folder chosen and then deleted is an error, not
// every bookmark.
async function rootNodeOf(id: string | undefined): Promise<Node> {
  if (!id) return (await browser.bookmarks.getTree())[0]!;
  const [node] = await browser.bookmarks.getSubTree(id).catch(() => [] as Node[]);
  if (!node || node.url) throw new Error('The bookmarks folder chosen in Settings → Bookmarks no longer exists: choose another one there.');
  return node;
}

// Every bookmark and folder under the root, each with its folder's path.
export const allBookmarks = (settings: Settings) => bookmarksUnder(rootIdOf(settings));
export async function bookmarksUnder(rootId: string | undefined): Promise<Bookmark[]> {
  const out: Bookmark[] = [];
  const walk = (children: Node[], path: string) => {
    for (const child of children) {
      out.push({ id: child.id, title: child.title, url: child.url, path, dateAdded: child.dateAdded });
      if (!child.url) walk(child.children ?? [], pathIn(path, child.title));
    }
  };
  walk(childrenOf(await rootNodeOf(rootId), !rootId), '');
  return out;
}

// A folder's path below the one it is in ("" at the root).
const pathIn = (path: string, title: string) => (path ? `${path}/${title}` : title);
export const folderPath = (b: Bookmark) => pathIn(b.path, b.title);
const noFolder = (id: string) => new Error(`No folder with id ${id} among the bookmarks the extension can see.`);

// The bookmarks (not folders) best matching the query, by title (weighing more), URL and folder.
// `match`: how much of the query each covers (search/bm25). Whole words, as auto-attach compares a
// message; with `prefix` (a search: the panel's, bookmarks.search), words also find those they begin;
// with `unseen` (auto-attach), the message's words no bookmark has count against the match.
export async function rankBookmarks(settings: Settings, query: string, limit: number, options: MatchOptions = {}): Promise<{ bookmark: Bookmark; match: number }[]> {
  const links = (await allBookmarks(settings)).filter((b) => b.url);
  const docs = links.map((b) => indexTexts(b, [[b.title, 3], [urlWords(b.url!), 1], [b.path, 1]]));
  return scored(query, docs, options)
    .sort((a, b) => b.score - a.score || (b.item.dateAdded ?? 0) - (a.item.dateAdded ?? 0))
    .slice(0, limit)
    .map((r) => ({ bookmark: r.item, match: r.match }));
}
export const searchBookmarks = async (settings: Settings, query: string, limit: number) => (await rankBookmarks(settings, query, limit, { prefix: true })).map((r) => r.bookmark);

// "https://www.example.com/a-b?c" → "example com a b c": its words, for the search.
const urlWords = (url: string) => url.replace(/^[a-z]+:\/\/(www\.)?/i, '').replace(/[^\p{L}\p{N}]+/gu, ' ');

// A folder's contents: the root's when none is named. `id` must be inside the root.
export async function folderContents(settings: Settings, id?: string): Promise<{ path: string; items: Bookmark[] }> {
  const all = await allBookmarks(settings);
  if (!id) return { path: '', items: all.filter((b) => b.path === '') };
  const folder = all.find((b) => b.id === id && !b.url);
  if (!folder) throw noFolder(id);
  const path = folderPath(folder);
  return { path, items: all.filter((b) => b.path === path) };
}

// A bookmark or folder inside the root, by id.
export async function bookmarkById(settings: Settings, id: string): Promise<Bookmark | undefined> {
  return (await allBookmarks(settings)).find((b) => b.id === id);
}

// Where a new bookmark goes: the folder named (inside the root), else the root itself.
export async function saveBookmark(settings: Settings, b: { title: string; url: string; folderId?: string }): Promise<Bookmark> {
  const root = await rootNodeOf(rootIdOf(settings));
  let parentId = root.id;
  let path = '';
  if (b.folderId) {
    const folder = await bookmarkById(settings, b.folderId);
    if (!folder || folder.url) throw noFolder(b.folderId);
    parentId = folder.id;
    path = folderPath(folder);
  } else if (!rootIdOf(settings)) {
    // The whole tree's root takes no bookmarks: the browser's "Other bookmarks" folder.
    const other = otherFolder(root);
    if (!other) throw new Error('The browser has no bookmarks folder to save into.');
    parentId = other.id;
    path = other.title;
  }
  const made = await browser.bookmarks.create({ parentId, title: b.title, url: b.url });
  return { id: made.id, title: made.title, url: made.url, path, dateAdded: made.dateAdded };
}

// Removes a bookmark or an empty folder inside the root.
export async function deleteBookmark(settings: Settings, id: string): Promise<Bookmark> {
  const b = await bookmarkById(settings, id);
  if (!b) throw new Error(`No bookmark with id ${id} among the bookmarks the extension can see.`);
  await browser.bookmarks.remove(id); // a folder with something in it is refused by the browser
  return b;
}

// Every folder of the browser, as a tree, for Settings → Bookmarks to pick the root from: its id,
// name, how deep it is and its path.
export interface Folder { id: string; title: string; depth: number; path: string }
export async function everyFolder(): Promise<Folder[]> {
  const out: Folder[] = [];
  const walk = (children: Node[], path: string, depth: number) => {
    for (const child of children) {
      if (child.url) continue;
      const p = pathIn(path, child.title);
      out.push({ id: child.id, title: child.title, depth, path: p });
      walk(child.children ?? [], p, depth + 1);
    }
  };
  walk(topFolders((await browser.bookmarks.getTree())[0]!), '', 0);
  return out;
}

// A folder for the extension in the browser's "Other bookmarks" (made once; the one there is reused).
export async function defaultFolder(): Promise<string> {
  const [tree] = await browser.bookmarks.getTree();
  const other = otherFolder(tree!);
  if (!other) throw new Error('The browser has no bookmarks folder to make one in.');
  const there = other.children?.find((c) => !c.url && c.title === DEFAULT_FOLDER_TITLE);
  return there?.id ?? (await browser.bookmarks.create({ parentId: other.id, title: DEFAULT_FOLDER_TITLE })).id;
}

// "b::<slug>" in a message attaches that bookmark: its title in lowercase with dashes.
export const bookmarkSlugs = (typed: string) => slugsAfter('b::', typed);
export const bookmarkSlug = (b: Bookmark) => slugOf(b.title || b.url || b.id);
