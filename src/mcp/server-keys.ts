// What goes by an MCP server's name, its policy key "mcp:<name>" (core/mcp-keys serverPolicyHost): its
// policy for Browser and the page widget, for every agent that has it among its sites, and for this
// browser session's conversations; and its logs. They move with the server when it is renamed and go
// with it when it is removed: a server given that name later must not inherit "act without asking".
import { agentStore, withSite } from '../agents/profiles';
import { movePolicyKey } from '../policy/store';
import { serverPolicyHost } from '../core/mcp-keys';
import { clearMcpLogs, renameMcpLogs } from './logs';

export async function moveServerKeys(from: string, to: string | undefined): Promise<void> {
  if (from === to) return;
  const [old, next] = [serverPolicyHost(from), to && serverPolicyHost(to)];
  await movePolicyKey(old, next);
  for (const agent of (await agentStore.load()).filter((a) => Object.hasOwn(a.sites, old))) {
    await agentStore.update(agent.id, (a) => {
      const policy = a.sites[old];
      const without = withSite(a, old, undefined);
      return next && policy ? withSite(without, next, policy) : without;
    });
  }
  await (to ? renameMcpLogs(from, to) : clearMcpLogs(from));
}
