// What happened with each MCP server: the tests in Settings, and the connections and tool calls of
// the agent. Kept for the browser session (storage.session), the latest first, for Settings → MCP
// servers ("Connection logs" and the status of each server).
import { browser } from 'wxt/browser';
import { serialized } from '../storage/serial';
import { watchKey } from '../storage/watch';

export interface McpLogEntry {
  at: number; // Date.now()
  server: string; // its name
  kind: 'test' | 'connect' | 'call' | 'sign-in';
  ok: boolean;
  detail: string; // e.g. "45 tools (streamable-http)", "todoist-find-tasks", or the error
  ms?: number;
  tools?: string[]; // what a test or a connection listed
  signIn?: boolean; // it failed because the server wants you signed in (mcp/oauth)
}

const KEY = 'mcpLogs';
const MAX = 200;

// One change at a time, also across the extension's pages (Settings tests, the background connects),
// so entries written together are all kept. A log that cannot be written never fails what it logs.
const serial = serialized(KEY);
const change = (next: (list: McpLogEntry[]) => McpLogEntry[]): Promise<void> =>
  serial(async () => {
    const { [KEY]: list = [] } = await browser.storage.session.get<{ [KEY]?: McpLogEntry[] }>(KEY);
    await browser.storage.session.set({ [KEY]: next(list) });
  }).catch((e) => console.warn('[mcp logs]', e));

export const logMcp = (entry: McpLogEntry) => change((list) => [entry, ...list].slice(0, MAX));

export const clearMcpLogs = (server: string) => change((list) => list.filter((e) => e.server !== server));

// A server renamed: its logs go with it.
export const renameMcpLogs = (from: string, to: string) => change((list) => list.map((e) => (e.server === from ? { ...e, server: to } : e)));

export const loadMcpLogs = async () => (await browser.storage.session.get<{ [KEY]?: McpLogEntry[] }>(KEY))[KEY] ?? [];

export function onMcpLogsChanged(cb: (logs: McpLogEntry[]) => void): () => void {
  return watchKey('session', KEY, (c) => cb((c.newValue as McpLogEntry[] | undefined) ?? []));
}

// A server's status: its latest test or connection.
export const latestStatus = (logs: McpLogEntry[], server: string) => logs.find((e) => e.server === server && e.kind !== 'call');
