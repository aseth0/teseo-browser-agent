import { useState } from 'react';
import { errorText } from '../../core/errors';
import { serverHeaders, type McpServerConfig } from '../../mcp/config';
import { logMcp } from '../../mcp/logs';
import { connectAndList } from '../../mcp/manager';
import { AccessNeeded, signIn, signInFlag } from '../../mcp/oauth';
import type { ProviderConfig } from '../../storage/settings';
import { allowSite } from '../ask-permission';
import { withMember } from '../edits';

// Testing a server and signing in to it, from a click (Settings → MCP servers): the servers busy
// with it, and for each, the site to allow for signing in.
export function useMcpServerActions(providers: ProviderConfig[]) {
  const [testing, setTesting] = useState<Set<string>>(new Set()); // server ids
  const [needsAccess, setNeedsAccess] = useState<Record<string, string>>({}); // server id → origin to allow for signing in
  const busy = (id: string, on: boolean) => setTesting((t) => withMember(t, id, on));
  // The result goes to the server's logs, which its status shows.
  const test = async (server: McpServerConfig) => {
    busy(server.id, true);
    const started = Date.now();
    try {
      await allowSite(server.url);
      const { tools, transport, client } = await connectAndList(server, serverHeaders(server, providers));
      void client.close();
      await logMcp({ at: Date.now(), server: server.name, kind: 'test', ok: true, detail: `${tools.length} tools (${transport})`, ms: Date.now() - started, tools: tools.map((t) => t.name) });
    } catch (e) {
      await logMcp({ at: Date.now(), server: server.name, kind: 'test', ok: false, detail: errorText(e), ms: Date.now() - started, ...signInFlag(e) });
    } finally {
      busy(server.id, false);
    }
  };
  // Signs in in the provider's page, then tests it. With `origin`: that site (the authorization
  // server's) allowed first, from this click.
  const signInTo = async (server: McpServerConfig, origin?: string) => {
    busy(server.id, true);
    const started = Date.now();
    let done = false;
    try {
      await allowSite(server.url);
      if (origin) await allowSite(origin);
      await signIn(server);
      done = true;
      setNeedsAccess(({ [server.id]: _done, ...rest }) => rest);
      await logMcp({ at: Date.now(), server: server.name, kind: 'sign-in', ok: true, detail: 'Signed in', ms: Date.now() - started });
    } catch (e) {
      if (e instanceof AccessNeeded) setNeedsAccess((n) => ({ ...n, [server.id]: e.origin }));
      await logMcp({ at: Date.now(), server: server.name, kind: 'sign-in', ok: false, detail: errorText(e), ms: Date.now() - started, signIn: true });
    } finally {
      busy(server.id, false);
    }
    if (done) await test(server);
  };
  return { testing, needsAccess, test, signInTo };
}
