// Tools over the browser's bookmarks (bookmarks/store): search and list them without asking; save
// and delete one, confirmed every time. Offered only once the user allows bookmarks (Settings →
// Bookmarks), and only within the folder chosen there. Titles and URLs are the pages' own text.
import { countArg, defineTool, fields, optString } from '../tools/define';
import { browser } from 'wxt/browser';
import { markPageData, text } from '../core/model-texts';
import type { Tool } from '../core/types';
import { isoDate } from '../core/util';
import { bookmarkById, deleteBookmark, folderContents, saveBookmark, searchBookmarks, type Bookmark } from './store';

const MAX_RESULTS = 20;

// "/" for the root, "/Recipes/Desserts" below it.
const shownPath = (path: string) => `/${path}`;

export const bookmarkLine = (b: Bookmark) =>
  text('result.bookmark_line', {
    id: b.id,
    title: markPageData(b.title, 'tool'),
    url: markPageData(b.url ?? '', 'tool'),
    path: shownPath(b.path),
    date: b.dateAdded ? isoDate(b.dateAdded) : '?',
  });
const folderLine = (b: Bookmark) => text('result.bookmark_folder_line', { id: b.id, title: markPageData(b.title, 'tool') });

export function bookmarkTools(): Tool[] {
  return [
    defineTool({
      name: 'bookmarks.search',
      description:
        "Searches the user's bookmarks by title, URL and folder, best matches first, each with its id, URL, folder and the date it was added. " +
        'Use it when the user refers to a page they bookmarked, or asks what they have saved about something.',
      inputSchema: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Words to look for; "a phrase in quotes" must appear as written' },
          limit: { type: 'number', description: `How many to list (default 10, at most ${MAX_RESULTS})` },
        },
        required: ['query'],
      },
      source: 'bookmarks',
      effect: 'read',
      siteless: true,
      args: (raw) => ({ query: String(fields(raw).query), limit: fields(raw).limit }),
      run: async ({ query, limit }, ctx) => {
        const found = await searchBookmarks(ctx.settings, query, countArg(limit, 10, MAX_RESULTS));
        if (!found.length) return { type: 'text', text: text('result.bookmark_no_match', { query }) };
        return { type: 'text', text: text('result.bookmark_results', { count: String(found.length), query, results: found.map(bookmarkLine).join('\n') }) };
      },
    }),
    defineTool({
      name: 'bookmarks.list',
      description:
        "Lists what is in a bookmarks folder: its bookmarks and its subfolders (each with its id, to list it in turn). Without folderId, the top of the user's bookmarks.",
      inputSchema: { type: 'object', properties: { folderId: { type: 'string', description: 'Id of the folder (from bookmarks__list or bookmarks__search)' } } },
      source: 'bookmarks',
      effect: 'read',
      siteless: true,
      args: (raw) => optString(fields(raw).folderId) || undefined,
      run: async (folderId, ctx) => {
        const { path, items } = await folderContents(ctx.settings, folderId);
        const lines = items.map((b) => (b.url ? bookmarkLine(b) : folderLine(b))).join('\n');
        return { type: 'text', text: text('result.bookmark_folder', { path: shownPath(path), items: lines || text('result.bookmark_folder_empty') }) };
      },
    }),
    {
      name: 'bookmarks.save',
      description:
        'Bookmarks a page: the URL given, or the page open in the panel. Into the folder given (folderId), else the top of the bookmarks. The user confirms it.',
      inputSchema: {
        type: 'object',
        properties: {
          title: { type: 'string', description: "Its title (default: the page's)" },
          url: { type: 'string', description: 'Default: the page open in the panel' },
          folderId: { type: 'string', description: 'Id of the folder (from bookmarks__list)' },
        },
      },
      source: 'bookmarks',
      effect: 'write',
      alwaysAsk: true,
      siteless: true,
      describe: async (args, ctx) => {
        const a = await saveArgs(args, ctx.tabId);
        return { summary: `Bookmark "${a.title}" (${a.url})${a.folderId ? ` in the folder ${a.folderId}` : ''}` };
      },
      run: async (args, ctx) => {
        const a = await saveArgs(args, ctx.tabId);
        const b = await saveBookmark(ctx.settings, a);
        return { type: 'text', text: text('result.bookmark_saved', { title: markPageData(b.title, 'tool'), path: shownPath(b.path), id: b.id }) };
      },
    },
    defineTool({
      name: 'bookmarks.delete',
      description: 'Deletes a bookmark, or an empty folder, by its id. The user confirms it.',
      inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
      source: 'bookmarks',
      effect: 'write',
      alwaysAsk: true,
      siteless: true,
      args: (raw) => String(fields(raw).id),
      describe: async (id, ctx) => {
        const b = await bookmarkById(ctx.settings, id);
        return { summary: b ? `Delete the ${b.url ? 'bookmark' : 'folder'} "${b.title}" from ${shownPath(b.path)}` : `Delete the bookmark ${id}` };
      },
      run: async (id, ctx) => {
        const b = await deleteBookmark(ctx.settings, id);
        return { type: 'text', text: text('result.bookmark_deleted', { title: markPageData(b.title, 'tool'), path: shownPath(b.path) }) };
      },
    }),
  ];
}

// What bookmarks.save will save: the page open in the panel fills what is not given. Checked before
// the user is asked too, so a card never asks for what would then fail.
export async function saveArgs(args: unknown, tabId: number | undefined): Promise<{ title: string; url: string; folderId?: string }> {
  const f = fields(args);
  const a = { title: optString(f.title), url: optString(f.url), folderId: optString(f.folderId) };
  const tab = !a.url || !a.title ? await (tabId === undefined ? undefined : browser.tabs.get(tabId).catch(() => undefined)) : undefined;
  const url = a.url || tab?.url;
  if (!url) throw new Error('No URL given and no page open in the panel.');
  if (!/^(https?|ftp|file):/i.test(url)) throw new Error(`Only web pages can be bookmarked, not "${url}".`);
  return { title: a.title || tab?.title || url, url, folderId: a.folderId || undefined };
}

