// The group a tool is listed under: its own (a page's WebMCP tools, an MCP server's), else its source's.
// Settings → Tools, the chat's tools menu and agents.catalog list them by it.
import type { Tool } from './types';

const SOURCE_GROUP: Record<Tool['source'], string> = { browser: 'browser', user: 'user', history: 'history', memory: 'memory', bookmarks: 'bookmarks', skill: 'skills', template: 'site-templates', webmcp: 'webmcp', mcp: 'mcp', web: 'web', custom: 'custom', agent: 'agents', speech: 'speech' };
export const toolGroup = (t: Pick<Tool, 'source' | 'group'>) => t.group ?? SOURCE_GROUP[t.source];

// A group's name as the views and the model read it (tools/match): "MCP · github", a custom tools' section by its name.
const GROUP_LABELS: Record<string, string> = {
  browser: 'Browser',
  user: 'User (questions, picking, plan)',
  history: 'History (saved conversations)',
  memory: 'Memory',
  bookmarks: 'Bookmarks',
  web: 'Web (search and read)',
  custom: 'Custom tools (yours)',
  agents: 'Agents',
  speech: 'Speech (read aloud)',
  skills: 'Skills',
  'site-templates': 'Site templates',
  webmcp: 'WebMCP (offered by the page)',
  mcp: 'MCP servers',
  site: 'Site adapters',
};

export function toolGroupLabel(group: string): string {
  const [kind, name] = group.split(/:(.*)/);
  if (name && kind === 'webmcp') return `WebMCP · ${name}`;
  if (name && kind === 'mcp') return `MCP · ${name}`;
  if (name && kind === 'custom') return name;
  return GROUP_LABELS[group] ?? group;
}
