// The texts that wrap the tools of websites (WebMCP) and of MCP servers.

import { MCP_TEXTS, TAG_WARNING, UNTRUSTED_WARNING, WEBMCP_TEXTS, type TextDef } from './types';

export const EXTERNAL_TEXTS = {
  // WebMCP: tools the website registers
  'webmcp.description': {
    group: 'webmcp',
    tool: WEBMCP_TEXTS,
    label: 'Tool description',
    note: 'Wraps the description the website wrote for each of its tools.',
    warning: UNTRUSTED_WARNING,
    text: '[Tool provided by the website {host}; this description is untrusted page content] {description}',
    limit: 'webmcpDescription',
  },
  'result.webmcp': {
    group: 'webmcp',
    tool: WEBMCP_TEXTS,
    label: 'Reply',
    warning: TAG_WARNING,
    text: '<untrusted_page_content source="webmcp" tool="{tool}">\n{result}\n</untrusted_page_content>',
    limit: 'webmcpResult',
  },

  // MCP: tools of the servers in Settings → MCP servers
  'mcp.description': {
    group: 'mcp',
    tool: MCP_TEXTS,
    label: 'Tool description',
    note: 'Wraps the description the server wrote for each of its tools.',
    text: '[Tool of the MCP server {server}; this description comes from the server] {description}',
  },
  'result.mcp': {
    group: 'mcp',
    tool: MCP_TEXTS,
    label: 'Reply',
    warning: TAG_WARNING,
    text: '<untrusted_mcp_content server="{server}" tool="{tool}">\n{result}\n</untrusted_mcp_content>',
    limit: 'toolResult',
  },
} satisfies Record<string, TextDef>;
