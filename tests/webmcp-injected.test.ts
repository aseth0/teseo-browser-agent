// The functions injected into the page (page/webmcp) run there from their source alone: whatever they
// use from outside them (an import) is not there. Run so here, against a page's WebMCP.
import { describe, expect, it, vi } from 'vitest';
import { stripMarks } from '../src/core/model-texts';
import { TOOL_SETTINGS } from './helpers';

type Execute = (tool: { name: string }, input: string | object) => Promise<unknown>;
let execute: Execute = async () => 'ok';
const page = {
  window: { document: { modelContext: { getTools: async () => [{ name: 'add_item', description: 'Adds', inputSchema: {} }], executeTool: (t: { name: string }, i: string | object) => execute(t, i) } }, navigator: {} },
  location: { host: 'shop.example.com', href: 'https://shop.example.com/' },
};
// As the browser does: the function's source, in the page's world, with its arguments.
const executeScript = vi.fn(async ({ func, args }: { func: (...a: unknown[]) => unknown; args: unknown[] }) => {
  const inPage = new Function('window', 'location', `return (${func.toString()});`)(page.window, page.location) as (...a: unknown[]) => Promise<unknown>;
  return [{ result: await inPage(...args) }];
});
vi.mock('wxt/browser', () => ({ browser: { scripting: { executeScript } } }));
const { pageTools } = await import('../src/page/webmcp');

const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal };
const tool = async () => (await pageTools(1, 'https://shop.example.com/'))[0]!;

describe("a page's WebMCP tools, run as injected", () => {
  it('are listed', async () => {
    expect((await tool()).name).toBe('webmcp.add_item');
  });

  it("say the page's own error when its tool fails", async () => {
    execute = async () => {
      throw new Error('Out of stock');
    };
    await expect((await tool()).run({ id: 1 }, ctx)).rejects.toThrow(/Out of stock/);
  });

  it('send the arguments again as an object to a page that refuses them as text', async () => {
    const inputs: unknown[] = [];
    execute = async (_t, input) => {
      inputs.push(input);
      if (typeof input === 'string') throw new TypeError("Failed to parse input arguments: is not of type 'object'");
      return 'added';
    };
    const result = await (await tool()).run({ id: 1 }, ctx);
    expect(result.type === 'text' && stripMarks(result.text)).toContain('added');
    expect(inputs).toEqual(['{"id":1}', { id: 1 }]);
  });
});
