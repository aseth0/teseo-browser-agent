// A connection to a remote MCP server with the official SDK: Streamable HTTP, or the older SSE
// transport when the server only speaks that.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import type { jsonSchemaValidator } from '@modelcontextprotocol/sdk/validation/types.js';
import { browser } from 'wxt/browser';
import { withoutOrigin } from './origin';

// The SDK checks tool outputs against their schema with Ajv by default, which compiles code with
// new Function: not allowed in an extension (CSP). The model reads the output either way.
const noValidation: jsonSchemaValidator = {
  getValidator: () => (input) => ({ valid: true, data: input as never, errorMessage: undefined }),
};

interface McpConnection {
  client: Client;
  transport: 'streamable-http' | 'sse';
}

const newClient = () => new Client({ name: 'browser-agent', version: browser.runtime.getManifest().version }, { jsonSchemaValidator: noValidation });

// authProvider: a server signed in to with OAuth (mcp/oauth).
export async function connectMcp(url: string, headers: Record<string, string>, authProvider?: OAuthClientProvider): Promise<McpConnection> {
  const endpoint = new URL(url);
  await withoutOrigin(url);
  const requestInit = { headers };
  const streamable = newClient();
  try {
    await streamable.connect(new StreamableHTTPClientTransport(endpoint, { requestInit, authProvider }));
    return { client: streamable, transport: 'streamable-http' };
  } catch (first) {
    // Older servers: SSE. The SDK sends `requestInit`'s headers on the event stream too, with its own
    // (the OAuth token, the protocol version).
    const sse = newClient();
    try {
      await sse.connect(new SSEClientTransport(endpoint, { requestInit, authProvider }));
      return { client: sse, transport: 'sse' };
    } catch {
      throw first; // the Streamable HTTP error says more
    }
  }
}
