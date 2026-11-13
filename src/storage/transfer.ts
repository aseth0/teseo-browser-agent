// What the Settings lists of stored items share to export and import them (ui/collection): the files
// of other sections told apart, a JSON read from a URL, and which items an export takes.
import { hostOf, isObject } from '../core/util';

export type TransferKind = 'skills' | 'templates' | 'customTools' | 'actions' | 'agents' | 'memory' | 'mcpServers' | 'theme' | 'wordBlacklist';

// What a file of each kind is called, and where it is imported.
export const KIND_SECTION: Record<TransferKind, { file: string; section: string }> = {
  skills: { file: 'skills', section: 'Skills' },
  templates: { file: 'site templates', section: 'Site templates' },
  customTools: { file: 'custom tools', section: 'Custom tools' },
  actions: { file: 'actions', section: 'Actions' },
  agents: { file: 'agents', section: 'Agents' },
  memory: { file: 'memory', section: 'Memory' },
  mcpServers: { file: 'MCP servers', section: 'MCP servers' },
  theme: { file: 'theme', section: 'Appearance' },
  wordBlacklist: { file: 'word blacklist', section: 'Word blacklist' },
};

// The lists of the collections' exports, and the "type" of the files that have one (ui/themes/theme-file,
// word-blacklist/io).
const LISTS: TransferKind[] = ['skills', 'templates', 'customTools', 'actions', 'agents', 'memory'];
const TYPES: Partial<Record<string, TransferKind>> = { 'browser-agent-theme': 'theme', 'browser-agent-word-blacklist': 'wordBlacklist' };

// The kind of another section's file, when the JSON is one: without the section's own key, another's
// list of objects, an mcpServers object, or a typed file. Anything else may be one item of its own
// (an agent has lists of skill and template names).
export function otherKind(parsed: unknown, own: string): TransferKind | undefined {
  if (!isObject(parsed) || own in parsed) return undefined;
  const list = LISTS.find((k) => k !== own && Array.isArray(parsed[k]) && isObject(parsed[k][0]));
  if (list) return list;
  if (own !== 'mcpServers' && isObject(parsed.mcpServers)) return 'mcpServers';
  const typed = typeof parsed.type === 'string' ? TYPES[parsed.type] : undefined;
  return typed === own ? undefined : typed;
}

// A file's page on GitHub, read as its raw file.
export function rawUrl(url: string): string {
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/.exec(url.trim());
  return m ? `https://raw.githubusercontent.com/${m[1]}/${m[2]}/${m[3]}` : url.trim();
}

const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])$|\.test$/;

// Why the URL is not read: https only, but for local test hosts.
export function urlProblem(url: string): string | undefined {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return 'Not a web address.';
  }
  if (u.protocol === 'https:' || (u.protocol === 'http:' && LOCAL.test(u.hostname))) return undefined;
  return 'Use an https:// address.';
}

// The JSON at the URL, read now: without cookies or the cache, within a time and a size; why not, said.
export async function fetchJsonText(url: string, { fetch: get = fetch, timeoutMs = 15_000, maxBytes = 2 * 1024 * 1024 }: { fetch?: typeof fetch; timeoutMs?: number; maxBytes?: number } = {}): Promise<string> {
  const host = hostOf(url);
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);
  try {
    const res = await get(url, { credentials: 'omit', cache: 'no-store', signal: abort.signal });
    if (!res.ok) throw new Error(`${host} answered ${res.status}.`);
    const tooLarge = () => new Error(`Larger than ${maxBytes} bytes.`);
    if (Number(res.headers.get('content-length')) > maxBytes) throw tooLarge(); // said before it is read
    const text = await res.text();
    if (new TextEncoder().encode(text).length > maxBytes) throw tooLarge();
    try {
      JSON.parse(text);
    } catch {
      throw new Error('Not JSON: is it the raw file?');
    }
    return text;
  } catch (e) {
    if (abort.signal.aborted) throw new Error(`${host} did not answer in time.`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export type ExportScope = 'all' | 'shown' | 'selected';

// The items an export takes, in the list's order: those that can be exported, all of them, those the
// filter shows, or those selected.
export function exportSubset<T>(items: T[], { scope, shown, selected, id, exportable }: { scope: ExportScope; shown: T[]; selected: Set<string>; id: (t: T) => string; exportable: (t: T) => boolean }): T[] {
  const showing = new Set(shown.map(id));
  return items.filter((t) => exportable(t) && (scope === 'all' || (scope === 'shown' ? showing.has(id(t)) : selected.has(id(t)))));
}
