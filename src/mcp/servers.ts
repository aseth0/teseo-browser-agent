// Changes to the list of MCP servers that also move what goes by a server's name (mcp/server-keys):
// the list is saved first and its keys moved after, so a failed save leaves them where they were.
import type { McpServerConfig } from './config';
import { moveServerKeys } from './server-keys';

// Saves the list as `change` makes it from the latest one; settled once stored.
export type SaveServers = (change: (servers: McpServerConfig[]) => McpServerConfig[]) => Promise<void>;

// New ones get a name no other server has ("name_2"…).
function withFreeNames(servers: McpServerConfig[], list: McpServerConfig[]): McpServerConfig[] {
  const taken = new Set(servers.map((s) => s.name));
  return list.map((s) => {
    let name = s.name;
    for (let i = 2; taken.has(name); i++) name = `${s.name}_${i}`;
    taken.add(name);
    return { ...s, name };
  });
}

// The new servers as they were added (under the names given).
export async function addServers(save: SaveServers, list: McpServerConfig[]): Promise<McpServerConfig[]> {
  let named: McpServerConfig[] = [];
  await save((servers) => {
    named = withFreeNames(servers, list);
    return [...servers, ...named];
  });
  return named;
}

// A server edited; renamed, its keys go to the new name.
export async function updateServer(save: SaveServers, server: McpServerConfig): Promise<void> {
  let was: string | undefined;
  await save((servers) => {
    was = servers.find((s) => s.id === server.id)?.name;
    return servers.map((s) => (s.id === server.id ? { ...s, ...server } : s));
  });
  if (was !== undefined && was !== server.name) await moveServerKeys(was, server.name);
}

// A server removed, and its keys with it.
export async function removeServer(save: SaveServers, server: McpServerConfig): Promise<void> {
  await save((servers) => servers.filter((s) => s.id !== server.id));
  await moveServerKeys(server.name, undefined);
}
