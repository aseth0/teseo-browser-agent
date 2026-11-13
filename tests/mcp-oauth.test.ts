import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { McpServerConfig } from '../src/mcp/config';
import { fakeBrowser, fakeSecretDb, fakeStorage } from './fakes/browser';

const storage = fakeStorage();
const granted = new Set<string>();
const secrets = fakeSecretDb();
vi.mock('../src/storage/secret-db', () => secrets);
vi.mock('wxt/browser', () => ({
  browser: fakeBrowser(storage, {
    identity: { getRedirectURL: (path: string) => `https://ext.chromiumapp.org/${path}`, launchWebAuthFlow: vi.fn() },
    permissions: { contains: async ({ origins }: { origins: string[] }) => origins.every((o) => granted.has(o)) },
  }),
}));
const { AccessNeeded, oauthProvider, onSignInChanged, signedIn, signIn, signOut, SignInNeeded, usesOAuth } = await import('../src/mcp/oauth');

const server: McpServerConfig = { id: 's1', name: 'notes', url: 'https://mcp.example.com/mcp', enabled: true };

beforeEach(() => {
  storage.reset();
  secrets.data.clear();
  secrets.trusted = true;
  granted.clear();
});

describe('MCP OAuth', () => {
  it('is for servers without a key of their own', () => {
    expect(usesOAuth(server)).toBe(true);
    expect(usesOAuth({ ...server, headers: { authorization: 'Bearer x' } })).toBe(false);
    expect(usesOAuth({ ...server, providerId: 'litellm' })).toBe(false);
    expect(usesOAuth({ ...server, headers: { 'X-Other': 'y' } })).toBe(true);
  });

  it('in the background, says to sign in before registering a client or opening a page', async () => {
    const provider = oauthProvider(server, false);
    await expect(provider.clientInformation()).rejects.toBeInstanceOf(SignInNeeded);
    await expect(provider.redirectToAuthorization(new URL('https://auth.example.com/authorize'))).rejects.toBeInstanceOf(SignInNeeded);
    // Signed in: the client it registered, and its tokens (refreshed there too).
    await provider.saveClientInformation!({ client_id: 'c1' });
    await provider.saveTokens({ access_token: 't', token_type: 'Bearer' });
    expect(await provider.clientInformation()).toEqual({ client_id: 'c1' });
    expect(await signedIn([server])).toEqual(new Set(['s1']));
    // Another URL is another sign-in.
    expect(await oauthProvider({ ...server, url: 'https://other.example.com/mcp' }, false).tokens()).toBeUndefined();
  });

  it('uses the client the user gave, as a public client or with its secret', async () => {
    const provider = oauthProvider({ ...server, oauth: { clientId: 'mine', clientSecret: 'shh', scope: 'notes' } }, true);
    expect(await provider.clientInformation()).toEqual({ client_id: 'mine', client_secret: 'shh' });
    expect(provider.clientMetadata).toMatchObject({ redirect_uris: ['https://ext.chromiumapp.org/mcp'], token_endpoint_auth_method: 'client_secret_post', scope: 'notes' });
    expect(oauthProvider(server, true).clientMetadata.token_endpoint_auth_method).toBe('none');
  });

  it('asks for a site it may not reach before signing in', async () => {
    const error = await signIn(server).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AccessNeeded);
    expect((error as InstanceType<typeof AccessNeeded>).origin).toBe('https://mcp.example.com');
  });

  it('signing out drops the tokens; only signing in or out is a change, not a refresh', async () => {
    const changed = vi.fn();
    onSignInChanged(changed);
    const provider = oauthProvider(server, false);
    await provider.saveTokens({ access_token: 't', token_type: 'Bearer' });
    await provider.saveTokens({ access_token: 't2', token_type: 'Bearer' });
    expect(changed).not.toHaveBeenCalled();
    await signOut(server);
    expect(changed).toHaveBeenCalledOnce();
    expect(await provider.tokens()).toBeUndefined();
    expect(await signedIn([server])).toEqual(new Set());
  });

  it('keeps the sign-ins out of storage.local, and moves those earlier versions kept there', async () => {
    await oauthProvider(server, false).saveTokens({ access_token: 'secret-token', token_type: 'Bearer' });
    expect(JSON.stringify(storage.local.data)).not.toContain('secret-token');
    secrets.data.clear();
    storage.local.data.mcpAuth = { s1: { url: server.url, tokens: { access_token: 'old-token', token_type: 'Bearer' } } };
    expect((await oauthProvider(server, false).tokens())?.access_token).toBe('old-token');
    expect('mcpAuth' in storage.local.data).toBe(false);
  });
});
