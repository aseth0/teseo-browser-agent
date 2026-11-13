// MCP servers a provider offers: a LiteLLM proxy is also an MCP gateway. Its servers are listed at
// GET <root>/v1/mcp/server, each one served at <root>/<name>/mcp and all of them at <root>/mcp/,
// with the same API key in x-litellm-api-key.
import { API_KEY_PLACEHOLDER } from '../core/util';
import { buildHeaders } from '../providers/headers';
import type { ProviderConfig } from '../storage/settings';
import { LITELLM_KEY_HEADER, serverName, type McpServerConfig } from './config';
import { errorText } from '../core/errors';

export interface OfferedServer {
  name: string;
  description?: string;
  url: string;
}

// The provider's base URL without its /v1: where the gateway's routes are.
export const providerRoot = (baseURL: string) => baseURL.replace(/\/+$/, '').replace(/\/v1$/, '');

// The servers the provider offers; an error saying why there are none to list.
export async function offeredServers(provider: ProviderConfig): Promise<OfferedServer[]> {
  const root = providerRoot(provider.baseURL);
  let res: Response;
  try {
    // The provider's own headers (its extra ones too), and the key as the gateway takes it.
    const headers = { ...buildHeaders(provider.apiKey, provider.extraHeaders), ...(provider.apiKey && { [LITELLM_KEY_HEADER]: `Bearer ${provider.apiKey}` }) };
    res = await fetch(`${root}/v1/mcp/server`, { headers });
  } catch (e) {
    throw new Error(`Could not reach ${root} (${errorText(e)})`);
  }
  if (res.status === 404) throw new Error('This provider does not offer MCP servers (no /v1/mcp/server).');
  if (res.status === 401 || res.status === 403) throw new Error(`This provider's key cannot list its MCP servers (${res.status}).`);
  if (!res.ok) throw new Error(`The provider answered ${res.status} to /v1/mcp/server.`);
  const body = (await res.json()) as unknown;
  const list = (Array.isArray(body) ? body : ((body as { data?: unknown[] })?.data ?? [])) as Record<string, unknown>[];
  return list
    .map((s) => {
      const name = String(s.alias || s.server_name || s.name || s.server_id || '');
      return { name, description: typeof s.description === 'string' ? s.description : undefined, url: `${root}/${encodeURIComponent(name)}/mcp` };
    })
    .filter((s) => s.name);
}

// One of them (or, without a name, the gateway with all of them) as a server that uses the key.
export function providerServer(provider: ProviderConfig, offered?: OfferedServer): McpServerConfig {
  return {
    id: crypto.randomUUID(),
    name: serverName(offered?.name ?? `${provider.name}_gateway`),
    url: offered?.url ?? `${providerRoot(provider.baseURL)}/mcp/`,
    headers: { [LITELLM_KEY_HEADER]: `Bearer ${API_KEY_PLACEHOLDER}` },
    providerId: provider.id,
    enabled: true,
  };
}
