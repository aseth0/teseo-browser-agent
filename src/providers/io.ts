// Providers as JSON (Settings → Export and import): { "providers": [...] }, without their keys and the
// values of their extra headers (a header naming the key, "{{apiKey}}", stays: it holds none). The
// build's own provider stays out (its key comes with the build). Imported by name: one of a name
// already here replaces it, keeping its id, its key and its headers' values; any other is added, under
// the file's id while no provider here has it (so what points at it, a voice model say, still does),
// without a key. Its registered models (models in the picker) are the file's; a file without the list
// keeps those of the one it replaces.
import { API_KEY_PLACEHOLDER, isObject } from '../core/util';
import { sameName, type ImportRow } from '../storage/import';
import type { ProviderConfig } from '../storage/settings-types';
import { ENV_PROVIDER_ID } from '../storage/settings-migrate';
import { THINKING_PARAMS } from './thinking';

type Shared = Omit<ProviderConfig, 'apiKey'>;

const keptHeader = (v: string) => (v.includes(API_KEY_PLACEHOLDER) ? v : '');

export const exportableProviders = (providers: ProviderConfig[]) => providers.filter((p) => p.id !== ENV_PROVIDER_ID);

export function exportProviders(providers: ProviderConfig[]): string {
  const shared = exportableProviders(providers).map(({ apiKey: _key, extraHeaders, ...p }): Shared => ({
    ...p,
    ...(extraHeaders && { extraHeaders: Object.fromEntries(Object.entries(extraHeaders).map(([k, v]) => [k, keptHeader(v)])) }),
  }));
  return JSON.stringify({ providers: shared }, null, 2);
}

const THINKING = new Set<string>(THINKING_PARAMS.map((t) => t.value));

// The registered models of a provider of the file: its ids, each once (none: undefined); `kept` when the
// file has no list.
function registeredOf(raw: unknown, kept: string[] | undefined): string[] | undefined {
  if (raw === undefined) return kept;
  const ids = Array.isArray(raw) ? [...new Set(raw.filter((m): m is string => typeof m === 'string').map((m) => m.trim()).filter(Boolean))] : [];
  return ids.length ? ids : undefined;
}

// Why a provider of the file is left out, or none.
function problem(p: Record<string, unknown>): string | undefined {
  if (typeof p.name !== 'string' || !p.name.trim()) return 'it has no name.';
  if (typeof p.baseURL !== 'string') return 'it has no address (baseURL).';
  try {
    const u = new URL(p.baseURL);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return 'its address is not http(s).';
  } catch {
    return `${JSON.stringify(p.baseURL)} is not an address.`;
  }
  return undefined;
}

// The providers of the JSON, each with what importing it would do (a row each); a key from the file
// is never taken.
export function importProviders(json: string, existing: ProviderConfig[]): ImportRow<ProviderConfig>[] {
  const parsed = JSON.parse(json) as unknown;
  const list = isObject(parsed) && Array.isArray(parsed.providers) ? parsed.providers : Array.isArray(parsed) ? parsed : undefined;
  if (!list) throw new Error('No "providers" list in this JSON');
  const rows: ImportRow<ProviderConfig>[] = [];
  const taken = new Set(existing.map((p) => p.id));
  for (const raw of list) {
    const p = isObject(raw) ? raw : {};
    const name = typeof p.name === 'string' ? p.name.trim() : '';
    const why = problem(p);
    if (why) {
      rows.push({ name: name || '(no name)', status: 'left-out', why: `${name || '(no name)'}: ${why}` });
      continue;
    }
    if (rows.some((r) => r.status !== 'left-out' && sameName(r.name, name))) {
      rows.push({ name, status: 'left-out', why: `${name}: the file has this name more than once.` });
      continue;
    }
    const old = existing.find((e) => e.id !== ENV_PROVIDER_ID && sameName(e.name, name));
    const headers = isObject(p.extraHeaders) ? Object.fromEntries(Object.entries(p.extraHeaders).filter((e): e is [string, string] => typeof e[1] === 'string')) : undefined;
    const fileId = typeof p.id === 'string' && p.id && p.id !== ENV_PROVIDER_ID && !taken.has(p.id) ? p.id : undefined;
    const id = old?.id ?? fileId ?? crypto.randomUUID();
    taken.add(id);
    const models = registeredOf(p.models, old?.models);
    const item: ProviderConfig = {
      id,
      name,
      baseURL: (p.baseURL as string).trim(),
      apiKey: old?.apiKey ?? '',
      defaultModel: typeof p.defaultModel === 'string' ? p.defaultModel : '',
      ...(headers && { extraHeaders: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v || old?.extraHeaders?.[k] || ''])) }),
      ...(isObject(p.extraBody) && { extraBody: p.extraBody }),
      ...(typeof p.contextWindow === 'number' && Number.isFinite(p.contextWindow) && p.contextWindow > 0 && { contextWindow: p.contextWindow }),
      ...(typeof p.thinkingParam === 'string' && THINKING.has(p.thinkingParam) && { thinkingParam: p.thinkingParam as ProviderConfig['thinkingParam'] }),
      ...(models && { models }),
    };
    rows.push({ name, status: old ? 'replaces' : 'new', item });
  }
  return rows;
}

// The providers with those imported: each in place of the one of its id, or last.
export const withProviders = (providers: ProviderConfig[], imported: ProviderConfig[]) => [
  ...providers.map((p) => imported.find((i) => i.id === p.id) ?? p),
  ...imported.filter((i) => !providers.some((p) => p.id === i.id)),
];
