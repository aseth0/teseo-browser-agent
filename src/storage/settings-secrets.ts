// The secrets of the settings (the providers' keys and headers, the MCP servers' headers, client
// secrets and the provider whose key fills their "{{apiKey}}"): split from them to storage/secrets
// when saved, put back when read. Each is kept with the URL it was saved for: the URL stays in
// storage.local, where a content script may change it, and a secret never goes to another URL than
// the one the user gave it (they type it again).
import type { McpServerConfig } from '../mcp/config';
import { storageGet } from './area';
import { once, readSecret, updateSecret } from './secrets';
import { SETTINGS_KEY, type ProviderConfig, type Settings } from './settings-types';

// The secrets of the settings (storage/secrets), by provider and MCP server id, with the URL each is for.
export interface SettingsSecrets {
  providers?: Record<string, Pick<ProviderConfig, 'apiKey' | 'extraHeaders'> & { baseURL?: string }>;
  mcpServers?: Record<string, Pick<McpServerConfig, 'headers' | 'providerId'> & { clientSecret?: string; url?: string }>;
}

const defined = <T extends object>(o: T): T => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== '')) as T;

// The settings with each provider and each MCP server made anew by `each` (a list not there stays out).
function mapEntries(s: Partial<Settings>, each: { provider: (p: ProviderConfig) => ProviderConfig; server: (m: McpServerConfig) => McpServerConfig }): Partial<Settings> {
  const providers = s.providers?.map(each.provider);
  const mcpServers = s.mcpServers?.map(each.server);
  return { ...s, ...(providers && { providers }), ...(mcpServers && { mcpServers }) };
}

// The settings without their secrets (a provider's key left empty), and those secrets apart, each with
// its URL (a provider's also without any: the URL the build's key goes to, settings's envKeyFor).
export function splitSecrets(s: Partial<Settings>): { open: Partial<Settings>; secrets: SettingsSecrets } {
  const secrets: SettingsSecrets = {};
  const open = mapEntries(s, {
    provider: ({ apiKey, extraHeaders, ...p }) => {
      (secrets.providers ??= {})[p.id] = { baseURL: p.baseURL, ...defined({ apiKey, extraHeaders }) };
      return { ...p, apiKey: '' };
    },
    server: ({ headers, oauth, ...server }) => {
      const { clientSecret, ...openOAuth } = oauth ?? {};
      // The provider stays in storage.local too, a copy never read for it (earlier versions read it).
      const own = defined({ headers, clientSecret, providerId: server.providerId });
      if (Object.keys(own).length) (secrets.mcpServers ??= {})[server.id] = { url: server.url, ...own };
      return { ...server, ...(oauth && { oauth: openOAuth }) };
    },
  });
  return { open, secrets };
}

// Whether stored settings hold secrets: saved before storage/secrets, or written to storage.local by
// something other than saveSettings.
export const hasSecrets = (s: Partial<Settings>) =>
  Boolean(s.providers?.some((p) => p.apiKey || p.extraHeaders !== undefined) || s.mcpServers?.some((m) => m.headers !== undefined || m.oauth?.clientSecret !== undefined));

// The stored settings without what secrets they hold.
const withoutSecrets = (s: Partial<Settings>): Partial<Settings> =>
  mapEntries(s, {
    provider: ({ extraHeaders: _h, ...p }) => ({ ...p, apiKey: '' }),
    server: ({ headers: _h, oauth, ...m }) => {
      const { clientSecret: _c, ...rest } = oauth ?? {};
      return { ...m, ...(oauth && { oauth: rest }) };
    },
  });

// The settings with their secrets back: each only while its provider's or server's URL is the one it
// was saved for. What the stored settings say of secrets is never taken (settleStoredSecrets drops it).
export function withSecrets(s: Partial<Settings> | undefined, secrets: SettingsSecrets | undefined): Partial<Settings> | undefined {
  if (!s) return s;
  return mapEntries(withoutSecrets(s), {
    provider: (p) => {
      const own = secrets?.providers?.[p.id];
      const mine = own?.baseURL === p.baseURL ? own : undefined;
      return { ...p, apiKey: mine?.apiKey ?? '', ...defined({ extraHeaders: mine?.extraHeaders }) };
    },
    server: ({ providerId: _copy, ...m }) => {
      const own = secrets?.mcpServers?.[m.id];
      const mine = own?.url === m.url ? own : undefined;
      return { ...m, ...defined({ headers: mine?.headers, providerId: mine?.providerId }), ...(mine?.clientSecret !== undefined && { oauth: { ...m.oauth, clientSecret: mine.clientSecret } }) };
    },
  });
}

// Once: the secrets earlier versions kept in the stored settings moved to storage/secrets, and those
// kept before the URLs were given the URL they are for now.
async function moveLegacySecrets(): Promise<void> {
  await once('settingsSecrets', () =>
    updateSecret<SettingsSecrets>('settings', async (prev) => {
      const stored = await storageGet<Partial<Settings>>('local', SETTINGS_KEY);
      if (!stored) return { value: prev, notify: false };
      // As they were: those in the stored settings first, then those kept apart.
      const whole = mapEntries(stored, {
        provider: (p) => {
          const own = prev?.providers?.[p.id];
          return { ...p, apiKey: p.apiKey || own?.apiKey || '', ...defined({ extraHeaders: p.extraHeaders ?? own?.extraHeaders }) };
        },
        server: (m) => {
          const own = prev?.mcpServers?.[m.id];
          const clientSecret = m.oauth?.clientSecret ?? own?.clientSecret;
          return { ...m, ...defined({ headers: m.headers ?? own?.headers }), ...(clientSecret !== undefined && { oauth: { ...m.oauth, clientSecret } }) };
        },
      });
      const { open, secrets } = splitSecrets(whole);
      return { value: secrets, notify: true, ...(hasSecrets(stored) && { also: { [SETTINGS_KEY]: open } }) };
    }),
  );
}

// Once: the provider of each MCP server, kept only in the stored settings by earlier versions, kept
// with its secrets too (for its URL as it is now).
async function moveMcpProviders(): Promise<void> {
  await once('mcpProviderIds', () =>
    updateSecret<SettingsSecrets>('settings', async (prev = {}) => {
      const stored = await storageGet<Partial<Settings>>('local', SETTINGS_KEY);
      const servers = (stored?.mcpServers ?? []).filter((m) => m.providerId);
      if (!servers.length) return { value: prev, notify: false };
      const kept = { ...prev.mcpServers };
      for (const m of servers) {
        const own = kept[m.id];
        kept[m.id] = own?.url === m.url ? { ...own, providerId: m.providerId } : { url: m.url, providerId: m.providerId };
      }
      return { value: { ...prev, mcpServers: kept }, notify: true };
    }),
  );
}

// The secrets saved by a build before the URLs (≤ v0.57.15, which still shares the profile and
// writes them so), each given the URL its provider or server has now (a server's, its provider too),
// as moveLegacySecrets did: that build sends it there. The entries of a provider or server no longer stored are kept as they are.
function bindUnbound(secrets: SettingsSecrets | undefined, stored: Partial<Settings>): SettingsSecrets | undefined {
  if (!secrets) return secrets;
  const providerURLs = new Map(stored.providers?.map((p) => [p.id, p.baseURL]));
  const servers = new Map(stored.mcpServers?.map((m) => [m.id, m]));
  const providers = secrets.providers && Object.fromEntries(Object.entries(secrets.providers).map(([id, e]) => [id, e.baseURL === undefined && providerURLs.has(id) ? { ...e, baseURL: providerURLs.get(id) } : e]));
  // A server's also with the provider stored beside it, which that build reads for its "{{apiKey}}".
  const bound = (e: NonNullable<SettingsSecrets['mcpServers']>[string], m: McpServerConfig) => ({ ...e, url: m.url, ...(m.providerId && { providerId: m.providerId }) });
  const mcpServers = secrets.mcpServers && Object.fromEntries(Object.entries(secrets.mcpServers).map(([id, e]) => {
    const m = servers.get(id);
    return [id, e.url === undefined && m ? bound(e, m) : e];
  }));
  return { ...secrets, ...(providers && { providers }), ...(mcpServers && { mcpServers }) };
}

// Whether some of the secrets were saved without the URL their provider or server has stored (bindUnbound).
export const hasUnbound = (secrets: SettingsSecrets | undefined, stored: Partial<Settings> | undefined) =>
  Boolean(stored && JSON.stringify(bindUnbound(secrets, stored)) !== JSON.stringify(secrets));

// The moves once, then the secrets an older build saved without their URL bound to it, and what the
// stored settings hold of secrets removed unread: a content script may have written it, and taking it
// would let a page set a server's headers.
export async function settleStoredSecrets(): Promise<void> {
  await moveLegacySecrets();
  await bindAndClean();
  await moveMcpProviders(); // after: an entry an older build saved has its URL by then
}

async function bindAndClean(): Promise<void> {
  const [stored, secrets] = await Promise.all([storageGet<Partial<Settings>>('local', SETTINGS_KEY), readSecret<SettingsSecrets>('settings')]);
  if (!stored || (!hasSecrets(stored) && !hasUnbound(secrets, stored))) return;
  await updateSecret<SettingsSecrets>('settings', async (prev) => {
    const now = await storageGet<Partial<Settings>>('local', SETTINGS_KEY);
    if (!now) return { value: prev, notify: false };
    const value = bindUnbound(prev, now);
    return { value, notify: JSON.stringify(value) !== JSON.stringify(prev), ...(hasSecrets(now) && { also: { [SETTINGS_KEY]: withoutSecrets(now) } }) };
  });
}
