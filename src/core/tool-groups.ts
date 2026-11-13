// The group a tool is listed under: its own (a page's WebMCP tools, an MCP server's), else its source's.
// Settings → Tools, the chat's tools menu and agents.catalog list them by it.
import type { Tool } from './types';

const SOURCE_GROUP: Record<Tool['source'], string> = { browser: 'browser', user: 'user', history: 'history', memory: 'memory', bookmarks: 'bookmarks', skill: 'skills', template: 'site-templates', webmcp: 'webmcp', mcp: 'mcp', web: 'web', custom: 'custom', agent: 'agents', speech: 'speech' };
export const toolGroup = (t: Pick<Tool, 'source' | 'group'>) => t.group ?? SOURCE_GROUP[t.source];
