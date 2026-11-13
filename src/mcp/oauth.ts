// OAuth for remote MCP servers (the MCP authorization spec, done by the SDK: discovery, dynamic
// client registration, PKCE, refresh). Signing in happens from Settings → MCP servers, in the
// provider's own page (identity.launchWebAuthFlow, back at https://<id>.chromiumapp.org/mcp); the
// background only uses and refreshes the tokens, and says when a server needs signing in. Per
// server, in storage/secrets like the providers' keys (no content script can read them): never
// exported nor logged.
import { auth, type OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from '@modelcontextprotocol/sdk/shared/auth.js';
import { browser } from 'wxt/browser';
import { originPattern } from '../page/permissions';
import type { McpServerConfig } from './config';
import { moveOnce, onSecretChanged, readSecret, updateSecret } from '../storage/secrets';
import { errorText } from '../core/errors';

const KEY = 'mcpAuth'; // the secret's name, and its storage.local key in earlier versions

interface Stored {
  url: string; // the server's URL when signed in: another URL is another sign-in
  signedAt?: number; // set by signing in and out only (the background drops its connection then)
  client?: OAuthClientInformationMixed; // registered dynamically
  tokens?: OAuthTokens;
  verifier?: string; // PKCE, between the provider's page and the code exchange
}
type AllStored = Record<string, Stored>; // by server id

// Sign-ins kept in storage.local by earlier versions, moved to storage/secrets once (moveOnce: those
// there win; later, what is under the old key is removed unread, as a content script may have written it).
export const moveLegacySignIns = (): Promise<void> =>
  moveOnce(KEY, [KEY], async ({ [KEY]: legacy }) => updateSecret<AllStored>(KEY, (prev) => ({ value: { ...(legacy as AllStored), ...prev }, notify: true })));

const loadAll = async (): Promise<AllStored> => {
  await moveLegacySignIns();
  return (await readSecret<AllStored>(KEY)) ?? {};
};
// A server's sign-in while it is for the URL the server has now; else none yet, for that URL.
const storedFor = (all: AllStored, server: McpServerConfig): Stored => (all[server.id]?.url === server.url ? all[server.id]! : { url: server.url });
const load = async (server: McpServerConfig): Promise<Stored> => storedFor(await loadAll(), server);
// When each server was signed in or out: what onSignInChanged tells, not a refresh of the tokens.
const stamps = (all: AllStored) => JSON.stringify(Object.entries(all).filter(([, s]) => s.signedAt).map(([id, s]) => [id, s.signedAt]));
// Read at the time of writing, so another server's sign-in meanwhile is kept.
async function update(server: McpServerConfig, change: (s: Stored) => Stored | undefined): Promise<void> {
  await moveLegacySignIns();
  await updateSecret<AllStored>(KEY, (before = {}) => {
    const all = { ...before };
    const next = change(storedFor(all, server));
    if (next) all[server.id] = next;
    else delete all[server.id];
    return { value: all, notify: stamps(before) !== stamps(all) };
  });
}

// The server wants a signed-in user and nobody signed in (or the sign-in no longer works).
export class SignInNeeded extends Error {
  constructor(server: string) {
    super(`The MCP server "${server}" needs you to sign in: Settings → MCP servers.`);
  }
}

// For the logs and the errors: whether it failed for want of a sign-in.
export const signInFlag = (e: unknown): { signIn?: true } => (e instanceof SignInNeeded ? { signIn: true } : {});

// Signing in needs to reach a site the extension has no access to yet (the authorization server):
// asked from a click.
export class AccessNeeded extends Error {
  constructor(readonly origin: string) {
    super(`Signing in needs access to ${new URL(origin).host}.`);
  }
}

// OAuth only for servers without a key of their own: an Authorization header, or a provider's.
export const usesOAuth = (server: McpServerConfig) =>
  !server.providerId && !Object.keys(server.headers ?? {}).some((h) => h.toLowerCase() === 'authorization');

export const redirectUrl = () => browser.identity.getRedirectURL('mcp');

// interactive: from a click in Settings, the provider's page may open; otherwise a server that wants
// a sign-in fails with SignInNeeded, before any client is registered.
export function oauthProvider(server: McpServerConfig, interactive: boolean): OAuthClientProvider & { code?: string } {
  let state = '';
  const { clientId, clientSecret, scope } = server.oauth ?? {};
  return {
    code: undefined,
    get redirectUrl() {
      return redirectUrl();
    },
    get clientMetadata(): OAuthClientMetadata {
      return {
        client_name: 'Teseo - Browser Agent',
        redirect_uris: [redirectUrl()],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: clientSecret ? 'client_secret_post' : 'none',
        ...(scope && { scope }),
      };
    },
    state: () => (state = crypto.randomUUID()),
    async clientInformation() {
      const stored = await load(server);
      if (!interactive && !stored.tokens) throw new SignInNeeded(server.name);
      return clientId ? { client_id: clientId, ...(clientSecret && { client_secret: clientSecret }) } : stored.client;
    },
    saveClientInformation: (client) => update(server, (s) => ({ ...s, client })),
    tokens: async () => (await load(server)).tokens,
    saveTokens: (tokens) => update(server, (s) => ({ ...s, tokens })),
    saveCodeVerifier: (verifier) => update(server, (s) => ({ ...s, verifier })),
    async codeVerifier() {
      const { verifier } = await load(server);
      if (!verifier) throw new Error('No sign-in under way.');
      return verifier;
    },
    async invalidateCredentials(what) {
      await update(server, (s) => ({
        ...s,
        ...((what === 'all' || what === 'client') && { client: undefined }),
        ...((what === 'all' || what === 'tokens') && { tokens: undefined }),
        ...((what === 'all' || what === 'verifier') && { verifier: undefined }),
      }));
    },
    // The provider's page, in its own window; it comes back with the code (or why not).
    async redirectToAuthorization(url) {
      if (!interactive) throw new SignInNeeded(server.name);
      const back = await browser.identity.launchWebAuthFlow({ url: url.href, interactive: true }).catch((e: unknown) => {
        throw new Error(`Not signed in: ${errorText(e)}`);
      });
      const params = new URL(back ?? '').searchParams;
      if (params.get('error')) throw new Error(`Not signed in: ${params.get('error_description') ?? params.get('error')}`);
      if (params.get('state') !== state) throw new Error('Not signed in: the answer does not match the request.');
      this.code = params.get('code') ?? undefined;
      if (!this.code) throw new Error('Not signed in: no code came back.');
    },
  };
}

// From a click in Settings: signs in (the provider's page when needed) and keeps the tokens.
// AccessNeeded: a site to allow first (from a click), then sign in again.
export async function signIn(server: McpServerConfig): Promise<void> {
  const provider = oauthProvider(server, true);
  const scope = server.oauth?.scope || undefined;
  // Only sites the extension may reach: anything else is asked for first.
  const fetchFn: typeof fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (!(await browser.permissions.contains({ origins: [originPattern(url.href)] }))) throw new AccessNeeded(url.origin);
    return fetch(input, init);
  };
  const first = await auth(provider, { serverUrl: server.url, scope, fetchFn });
  if (first === 'REDIRECT') await auth(provider, { serverUrl: server.url, scope, fetchFn, authorizationCode: provider.code! });
  await update(server, (s) => ({ ...s, verifier: undefined, signedAt: Date.now() }));
}

export const signOut = (server: McpServerConfig) => update(server, () => ({ url: server.url, signedAt: Date.now() }));

// The servers signed in now (by id), for Settings.
export async function signedIn(servers: McpServerConfig[]): Promise<Set<string>> {
  const all = await loadAll();
  return new Set(servers.filter((s) => all[s.id]?.url === s.url && all[s.id]?.tokens).map((s) => s.id));
}

// Calls back when a server is signed in or out (not when its tokens are only refreshed).
export const onSignInChanged = (cb: () => void): (() => void) => onSecretChanged(KEY, cb);
