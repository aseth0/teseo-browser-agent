import { describe, expect, it, vi } from 'vitest';
import { serverProblems, type McpServerConfig } from '../src/mcp/config';
import { TOOL_SETTINGS } from './helpers';

const callTool = vi.fn(async (..._args: unknown[]) => ({ content: [{ type: 'text', text: 'done' }] }));
vi.mock('../src/mcp/connect', () => ({
  connectMcp: async () => ({
    transport: 'streamable-http',
    client: {
      close: async () => undefined,
      callTool,
      listTools: async () => ({ tools: [{ name: 'evaluate', inputSchema: { type: 'object' } }] }),
    },
  }),
}));

const { McpManager } = await import('../src/mcp/manager');
const server: McpServerConfig = { id: 'm', name: 'slow', url: 'https://mcp.example.com/mcp', enabled: true };
const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal };

async function optionsOfACall(config: McpServerConfig) {
  callTool.mockClear();
  const [tool] = (await new McpManager().tools([config], [])).tools;
  await tool!.run({}, ctx);
  return callTool.mock.calls[0]![2] as { signal: AbortSignal; timeout?: number };
}

describe("an MCP server's tool timeout", () => {
  it('goes with every call of its tools, in milliseconds', async () => {
    const options = await optionsOfACall({ ...server, toolTimeoutSeconds: 600 });
    expect(options.timeout).toBe(600_000);
    expect(options.signal).toBe(ctx.signal); // Stop still cuts the call
  });

  it('is left to the MCP client when the server has none', async () => {
    expect(await optionsOfACall(server)).not.toHaveProperty('timeout');
  });

  it('must be a whole number of seconds, from 1 to an hour', () => {
    const problems = (toolTimeoutSeconds?: number) => serverProblems({ ...server, toolTimeoutSeconds }, []);
    for (const fine of [undefined, 1, 600, 3600]) expect(problems(fine)).toEqual([]);
    for (const wrong of [0, -5, 1.5, 3601, Number.NaN]) expect(problems(wrong)).toEqual(['The tool timeout must be a whole number of seconds, from 1 to 3600']);
  });
});
