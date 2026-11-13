// The MCP servers' logs (mcp/logs), kept up to date for Settings → MCP servers.
import { loadMcpLogs, onMcpLogsChanged, type McpLogEntry } from '../mcp/logs';
import { useLive } from './useLive';

const NONE: McpLogEntry[] = [];
export const useMcpLogs = (): McpLogEntry[] => useLive(loadMcpLogs, onMcpLogsChanged, NONE, '[mcp logs]');
