// Sources of custom tools (Settings → Custom tools → Sources): a URL whose answer is the JSON of an
// export ({ "customTools": [...] }), say a file in a team's repository, read again at each sync. It is
// read with headers and the browser's session as a custom tool's request (a token, a signed-in site).
// Its tools are the source's: a sync adds the new ones off, replaces the others (keeping the user's
// header values, session and read-only), turns one off whose request or code changed until the user
// checks it, removes those no longer in it, and leaves out one named as a tool not from it.
import type { Tool } from '../../core/types';
import { requireAccess } from '../../page/access';
import { createCollection, type CollectionItem } from '../../storage/collection';
import { sameName } from '../../storage/import';
import { movedFirst, withSecretPart } from '../../storage/secret-part';
import { serialized } from '../../storage/serial';
import type { CustomTool } from './types';
import { importCustomTools } from './io';
import { customToolStore, whatItDoes } from './store';
import { NO_REDIRECT, refuseRedirect, requestHeaders, type HttpRequest } from '../http';
import { errorText } from '../../core/errors';
import { customToolSourcesAvailable } from '../../core/build';

export interface CustomToolSource extends CollectionItem {
  url: string;
  headers?: HttpRequest['headers'];
  session?: boolean; // the browser's cookies for its site; set by the user only
  syncedAt?: number;
  error?: string; // why its last sync failed
}

// Its headers' values and the session are kept in storage/secrets for its URL (storage/secret-part): a
// source a page writes to storage.local, or whose URL it changes, is read without them.
type SourcePart = Pick<CustomToolSource, 'headers' | 'session'>;
const openHeaders = (headers: CustomToolSource['headers']) => headers?.map((h) => ({ name: h.name, value: '' }));
const sources = withSecretPart<CustomToolSource, SourcePart>(createCollection<CustomToolSource>('customToolSources', []), {
  secret: 'customToolSourceSecrets',
  pick: (s) => ({ headers: s.headers, session: s.session }),
  strip: (s) => ({ ...s, ...(s.headers && { headers: openHeaders(s.headers) }) }), // a copy, its session never read
  put: ({ session: _s, ...s }, part) => ({ ...s, ...(s.headers && { headers: openHeaders(s.headers) }), ...(part?.headers && { headers: part.headers }), ...(part?.session && { session: true }) }),
  boundTo: (s) => s.url,
});
export const customToolSourceStore = movedFirst(sources, 'customToolSourceSecrets');

// The source's JSON, read now (never from the cache).
// Not in a build that leaves sources out (core/build STORE_LEAVES_OUT).
export async function readSource(source: Pick<CustomToolSource, 'url' | 'headers' | 'session'>, signal?: AbortSignal): Promise<string> {
  if (!customToolSourcesAvailable()) throw new Error('Custom tool sources are not in this version of Teseo.');
  await requireAccess(source.url, 'read');
  const filled = await requestHeaders(source, source.url, false);
  if ('problem' in filled) throw new Error(filled.problem);
  const res = await fetch(source.url, { headers: filled.headers, credentials: source.session ? 'include' : 'omit', cache: 'no-store', redirect: NO_REDIRECT, signal });
  refuseRedirect(res, source.url);
  if (!res.ok) throw new Error(`${new URL(source.url).host} answered ${res.status}${res.status === 401 || res.status === 403 ? ' (signed in? its headers?)' : ''}.`);
  return res.text();
}

export interface SourceSync {
  save: CustomTool[];
  remove: CustomTool[];
  added: string[]; // new, off
  changed: string[]; // turned off: another request or code
  skipped: string[]; // with why
  needSession: string[]; // a header takes a cookie: the session must be ticked in it
}

export function syncSource(json: string, sourceId: string, customs: CustomTool[], catalog: Pick<Tool, 'name' | 'source' | 'inputSchema'>[]): SourceSync {
  const mine = customs.filter((c) => c.source?.id === sourceId);
  const others = customs.filter((c) => c.source?.id !== sourceId);
  const { tools, skipped, needSession, named } = importCustomTools(json, mine, catalog);
  const result: SourceSync = { save: [], remove: [], added: [], changed: [], skipped, needSession: [] };
  for (const tool of tools) {
    if (others.some((o) => sameName(o.name, tool.name))) {
      result.skipped.push(`${tool.name}: a tool of yours, or of another source, has that name.`);
      continue;
    }
    const old = mine.find((o) => sameName(o.name, tool.name));
    const does = whatItDoes(tool);
    if (needSession.includes(tool.name)) result.needSession.push(tool.name);
    if (!old) result.added.push(tool.name);
    else if (old.source!.does !== does) result.changed.push(tool.name);
    const same = old && old.source!.does === does;
    result.save.push({ ...tool, enabled: same ? old.enabled : false, source: same ? old.source! : { id: sourceId, does, ...(old && { changed: true }) } });
  }
  // One still in it, though left out this time (a mistake in the file), stays as it was.
  result.remove = mine.filter((o) => !named.some((n) => sameName(n, o.name)));
  return result;
}

// A sync, done: the source read, its tools saved and removed, its state kept. One at a time, from any
// page (two at once would both add its new tools), each with the tools as stored by then.
const oneAtATime = serialized('custom-tool-sources');
export function runSync(source: CustomToolSource, catalog: Pick<Tool, 'name' | 'source' | 'inputSchema'>[]): Promise<SourceSync> {
  return oneAtATime(async () => {
    try {
      const result = syncSource(await readSource(source), source.id, await customToolStore.load(), catalog);
      await customToolStore.saveMany(result.save);
      await customToolStore.removeMany(result.remove.map((t) => t.id));
      // Only its state: the user may have edited it meanwhile, or removed it (then it stays gone).
      await customToolSourceStore.update(source.id, { syncedAt: Date.now(), error: undefined });
      return result;
    } catch (e) {
      await customToolSourceStore.update(source.id, { error: errorText(e) });
      throw e;
    }
  });
}

// The tools of a source no longer in the list stay, as the user's own.
export const unsourced = (customs: CustomTool[], sourceId: string): CustomTool[] =>
  customs.filter((c) => c.source?.id === sourceId).map(({ source: _source, ...c }) => c);
