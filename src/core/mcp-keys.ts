// The policy key of an MCP server's tools (core/policy): like a website's host. Its tools' group
// (Tool.group) is the same key. A leaf, so that policy, agents and tools can read it without
// importing mcp.
const MCP_PREFIX = 'mcp:';
export const serverPolicyHost = (name: string) => `${MCP_PREFIX}${name}`;
export const mcpGroup = serverPolicyHost;
const MCP_POLICY_HOST = new RegExp(`^${MCP_PREFIX}\\S+$`);
export const isMcpPolicyHost = (key: string | undefined) => !!key && MCP_POLICY_HOST.test(key);
// The server a policy key or a tool group names; none when it is not a server's.
export const mcpServerOf = (key: string) => (isMcpPolicyHost(key) ? key.slice(MCP_PREFIX.length) : undefined);
