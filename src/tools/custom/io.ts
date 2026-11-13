// Custom tools as JSON, to back them up or share them (Settings → Custom tools): { "customTools": [...] }.
// Exported without the values of their headers and of their {{secret:…}} unless asked (they hold API
// keys); imported checked like the editor checks them, and off until the user switches them on (their
// descriptions reach the model, and the file comes from elsewhere). Sending the browser's session, and a request that
// only reads, are the user's choice: a file never turns them on, only keeps them for a tool of the
// same name that had them.
import type { Tool } from '../../core/types';
import { SCRIPT_BASE } from './script-tool';
import { customProblems } from './validate';
import type { CustomTool } from './types';
import { cookiesIn, type HttpRequest } from '../http';
import { importNamed, listFrom, type ImportRow } from '../../storage/import';

type Shared = Omit<CustomTool, 'id' | 'enabled' | 'builtin' | 'source'>;

export function exportCustomTools(customs: CustomTool[], withKeys = false): string {
  const shared = customs.map(({ id: _id, enabled: _enabled, builtin: _builtin, source: _source, ...c }): Shared => {
    if (!c.http || withKeys) return c;
    const { secrets: _secrets, ...http } = c.http; // the values of its {{secret:…}}: kept like the headers' values
    return { ...c, http: { ...http, ...(http.headers && { headers: http.headers.map((h) => ({ name: h.name, value: '' })) }) } };
  });
  return JSON.stringify({ customTools: shared }, null, 2);
}

// The tools in the JSON ({ "customTools": [...] }, a list, or one), each new or replacing the one of
// its name (whose header values stay when the file has them empty), those left out, with why, and those
// that need the user's session ticked (a header takes a cookie: a file never turns it on); `named`:
// every name in the file, left out or not; and a row each (one replacing a tool synced from a source
// leaves that source: it comes in as yours).
export function importCustomTools(json: string, existing: CustomTool[], catalog: Pick<Tool, 'name' | 'source' | 'inputSchema'>[]): { tools: CustomTool[]; skipped: string[]; needSession: string[]; named: string[]; rows: ImportRow<CustomTool>[] } {
  const list = listFrom(json, 'customTools');
  // A header takes a cookie, and the session is not ticked.
  const needs = (tool: CustomTool) => !tool.http?.session && (tool.http?.headers ?? []).some((h) => cookiesIn(h.value).length > 0);
  const { items: tools, skipped, rows: built } = importNamed<CustomTool>({
    list,
    existing,
    build: (loose, old) => {
      const item = asExported(loose);
      return {
        name: String(item?.name ?? '').trim(),
        description: String(item?.description ?? ''),
        base: String(item?.base ?? ''),
        params: item?.params ?? {},
        ...(item?.inputs && { inputs: item.inputs }),
        ...(typeof item?.script === 'string' && { script: item.script }),
        ...(Array.isArray(item?.labels) && { labels: item.labels.map(String) }),
        ...(typeof item?.group === 'string' && item.group.trim() && { group: item.group.trim() }),
        ...(item?.http && { http: { ...withoutUserChoices(item.http), ...userChoices(item.http, old?.http) } }),
        ...(item?.createdBy === 'model' && { createdBy: 'model' as const }),
        enabled: false,
      };
    },
    // Checked as with the session: wanting it is no reason to leave it out (it comes in off).
    problems: (tool, others) => customProblems(needs(tool) ? { ...tool, http: { ...tool.http!, session: true } } : tool, others, catalog),
  });
  const named = list.map((loose) => String(asExported(loose as Loose)?.name ?? '').trim());
  const rows = built.map((row): ImportRow<CustomTool> => {
    const from = row.status === 'replaces' ? existing.find((e) => e.id === row.item!.id)?.source : undefined;
    return from ? { ...row, status: 'leaves-source', sourceId: from.id } : row;
  });
  return { tools, skipped, needSession: tools.filter(needs).map((t) => t.name), named, rows };
}

// A tool as written by hand or by a model, in the exported shape: a script's site as "site" or "host"
// (or in "script": {host, code}), its code as "script", and headers as an object {name: value} or a
// list, beside "http" or in it.
type Header = { name: string; value: string };
type Loose = Partial<Omit<CustomTool, 'script' | 'http'>> & {
  script?: string | { host?: string; code?: string; headers?: unknown; uses?: unknown };
  http?: Partial<HttpRequest> & { headers?: unknown };
  site?: string;
  host?: string;
  headers?: unknown;
};
function asExported(loose: Loose): Partial<CustomTool> {
  const { script, http, site, host, headers, ...rest } = loose ?? {};
  const asObject = typeof script === 'object' && script ? script : undefined;
  const code = typeof script === 'string' ? script : asObject?.code;
  const given = headerList(http?.headers ?? headers ?? asObject?.headers);
  const url = http?.url ?? asObject?.host ?? site ?? host;
  const request: HttpRequest | undefined = http || rest.base === SCRIPT_BASE || url
    ? { method: 'GET', ...http, url: String(url ?? ''), ...(given && { headers: given }) }
    : undefined;
  // The tools a script calls, in "script" too (as custom_tools.save takes them).
  const uses = Array.isArray(asObject?.uses) ? asObject.uses.map(String) : rest.uses;
  return { ...rest, ...(code !== undefined && { script: String(code) }), ...(uses?.length && { uses }), ...(request && { http: request }) };
}
const headerList = (headers: unknown): Header[] | undefined =>
  Array.isArray(headers) ? headers.map((h: Partial<Header>) => ({ name: String(h?.name ?? ''), value: String(h?.value ?? '') }))
  : headers && typeof headers === 'object' ? Object.entries(headers).map(([name, value]) => ({ name, value: String(value) }))
  : undefined;

// What only the user turns on: the browser's session, and a request that only reads.
const withoutUserChoices = ({ session: _session, readOnly: _readOnly, ...http }: NonNullable<CustomTool['http']>) => http;

// What the user had set for the tool of that name (header values the file leaves empty, saved secrets,
// the session, read only), kept only while the request goes to the same site with the same method:
// never sent to another host, nor a write taken for a read.
const siteOf = (url: string) => (/^https?:\/\/[^/{}?#]+/i.exec(url.trim())?.[0] ?? url.trim()).toLowerCase();
const sameTarget = (a: HttpRequest, b: HttpRequest) => siteOf(a.url) === siteOf(b.url) && (a.method ?? 'GET').toUpperCase() === (b.method ?? 'GET').toUpperCase();
function userChoices(http: HttpRequest, old: HttpRequest | undefined): Partial<HttpRequest> {
  const kept = old && sameTarget(http, old) ? old : undefined;
  return { headers: keptHeaders(http.headers, kept?.headers), ...(!http.secrets && kept?.secrets && { secrets: kept.secrets }), ...(kept?.session && { session: true }), ...(kept?.readOnly && { readOnly: true }) };
}

// A header without a value in the file keeps the one the user had set.
const keptHeaders = (headers: { name: string; value: string }[] | undefined, old: { name: string; value: string }[] | undefined) =>
  headers?.map((h) => (h.value ? h : { ...h, value: old?.find((o) => o.name === h.name)?.value ?? '' }));
