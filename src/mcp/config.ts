// MCP servers as configured in Settings → MCP servers: remote ones (Streamable HTTP, SSE as a
// fallback), by URL with their headers, or offered by a provider (e.g. a LiteLLM gateway) and using
// its API key. Imported and exported in the mcpServers format of Claude Desktop and Cursor.
import { API_KEY_PLACEHOLDER, fillApiKey, isObject } from '../core/util';
import type { ProviderConfig } from '../storage/settings';

export interface McpServerConfig {
  id: string;
  name: string; // [a-z0-9_-]: tools are mcp.<name>.<tool>
  url: string;
  headers?: Record<string, string>; // "{{apiKey}}" is the provider's key
  providerId?: string; // the provider whose key it uses (a server it offers)
  // Run the tools the server marks read-only (readOnlyHint) without confirmation. Off by default:
  // the hint comes from the server, and a wrong or malicious one would skip the per-server policy.
  trustReadOnlyHints?: boolean;
  // Signing in (mcp/oauth), for a server that does not register clients itself: the client it gave
  // you, and the scope to ask for. None: dynamic registration, and the scope the server says.
  oauth?: { clientId?: string; clientSecret?: string; scope?: string };
  onDemand?: boolean; // its tools offered once the model loads them (tools/load); not exported
  // Its own choice of when its tools reach the model, over Settings → Tools → Matching (tools/match):
  // 'always' (in every request), 'recommend' (recommended when your message matches them), 'matching'
  // (only when it matches them); none: that setting's. Not exported. onDemand wins (an older build reads
  // only that).
  matching?: 'always' | 'recommend' | 'matching';
  // What it is for, in your words and language (its panel in Settings → MCP servers): tool matching compares it
  // with your message together with its tools, by words and by meaning (tools/match); never sent to the model.
  // Not exported (the mcpServers format has no place for it).
  about?: string;
  // How long a call of its tools may take; none: the MCP client's own limit (60 s). Not exported.
  toolTimeoutSeconds?: number;
  enabled: boolean;
}

// When a server's tools reach the model: as Settings → Tools → Matching says (the default; with All tools,
// in every request, as before), always, recommended or only when your message matches them, or once the
// model loads them (tools.load).
export type Offer = 'follow' | 'always' | 'recommend' | 'matching' | 'demand';
const OWN = ['always', 'recommend', 'matching'] as const;
export const offerOf = (s: Pick<McpServerConfig, 'onDemand' | 'matching'>): Offer =>
  s.onDemand ? 'demand' : s.matching && OWN.includes(s.matching) ? s.matching : 'follow';
// The change that sets it (the server's editor and its panel in Settings → MCP servers).
export const offerChange = (offer: Offer): Pick<McpServerConfig, 'onDemand' | 'matching'> => ({
  onDemand: offer === 'demand' || undefined,
  matching: offer === 'always' || offer === 'recommend' || offer === 'matching' ? offer : undefined,
});

// The gateway's own auth header (LiteLLM): its MCP endpoints do not read Authorization.
export const LITELLM_KEY_HEADER = 'x-litellm-api-key';

// Without "__": its tools' names (mcp__<server>__<tool> to the model) must say where the server's ends.
export const serverName = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '') || 'server';

export const MAX_TOOL_TIMEOUT_SECONDS = 3600;
const validToolTimeout = (seconds: number | undefined) =>
  seconds === undefined || (Number.isInteger(seconds) && seconds >= 1 && seconds <= MAX_TOOL_TIMEOUT_SECONDS);

// Problems to fix before saving; empty when it can be saved. `servers`: those saved (the logs, the
// policy and the tools' names go by its name, so it is the only one with it).
export function serverProblems(draft: McpServerConfig, servers: McpServerConfig[]): string[] {
  return [
    !draft.name && 'Give it a name',
    servers.some((s) => s.id !== draft.id && s.name === draft.name) && 'Another server already has this name.',
    draft.name.includes('__') && 'A server name can\'t contain "__".',
    !/^https?:\/\//.test(draft.url) && 'The URL must start with http:// or https://',
    !validToolTimeout(draft.toolTimeoutSeconds) && `The tool timeout must be a whole number of seconds, from 1 to ${MAX_TOOL_TIMEOUT_SECONDS}`,
  ].filter((p): p is string => Boolean(p));
}

// The headers sent, with the provider's key in place of "{{apiKey}}".
export function serverHeaders(server: McpServerConfig, providers: ProviderConfig[]): Record<string, string> {
  const key = providers.find((p) => p.id === server.providerId)?.apiKey ?? '';
  return Object.fromEntries(Object.entries(server.headers ?? {}).map(([k, v]) => [k, fillApiKey(String(v), key)]));
}

// Headers typed as JSON (Settings → MCP servers): an object of texts, or why not.
export function parseHeaders(json: string): { headers: Record<string, string> } | { problem: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json.trim() || '{}');
  } catch {
    return { problem: 'The headers are not valid JSON' };
  }
  if (!isObject(parsed)) return { problem: 'The headers must be a JSON object, like {"Authorization": "Bearer {{apiKey}}"}' };
  const notText = Object.entries(parsed).find(([, v]) => typeof v !== 'string');
  if (notText) return { problem: `The header "${notText[0]}" must be a text, in quotes` };
  return { headers: parsed as Record<string, string> };
}

// The texts of a JSON object, by name (the rest left out); undefined when it is not one.
function stringRecord(v: unknown): Record<string, string> | undefined {
  if (!isObject(v)) return undefined;
  return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === 'string'));
}

// Servers from an mcpServers JSON: remote ones are added (off until tested); local ones (command)
// are listed apart, for the stdio bridge to come. A header left empty (exported without its value)
// takes the value it has in a server of `existing` with the same URL.
export function importServers(json: string, existing: McpServerConfig[] = []): { servers: McpServerConfig[]; skipped: string[] } {
  const parsed: unknown = JSON.parse(json);
  const all = isObject(parsed) ? parsed.mcpServers : undefined;
  if (!isObject(all)) throw new Error('No "mcpServers" object in this JSON');
  const servers: McpServerConfig[] = [];
  const skipped: string[] = [];
  for (const [name, s] of Object.entries(all)) {
    const url = isObject(s) && typeof s.url === 'string' ? s.url : '';
    if (!url) {
      skipped.push(name);
      continue;
    }
    const given = isObject(s) ? stringRecord(s.headers) : undefined;
    const known = existing.find((e) => e.url === url)?.headers ?? {};
    const headers = given && Object.fromEntries(Object.entries(given).map(([k, v]) => [k, v || known[k] || '']));
    servers.push({ id: crypto.randomUUID(), name: serverName(name), url, ...(headers && { headers }), enabled: false });
  }
  return { servers, skipped };
}

// The servers as mcpServers JSON; a provider's key is left as "{{apiKey}}", never exported. The
// headers' values (they hold keys) are left empty unless asked, except those that only name the
// provider's key.
export function exportServers(servers: McpServerConfig[], withKeys = false): string {
  const shared = (headers: Record<string, string>) => (withKeys ? headers : Object.fromEntries(Object.entries(headers).map(([k, v]) => [k, v.includes(API_KEY_PLACEHOLDER) ? v : ''])));
  const mcpServers = Object.fromEntries(servers.map((s) => [s.name, { type: 'http', url: s.url, ...(s.headers && Object.keys(s.headers).length && { headers: shared(s.headers) }) }]));
  return JSON.stringify({ mcpServers }, null, 2);
}
