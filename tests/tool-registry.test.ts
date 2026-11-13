import { describe, expect, it, vi } from 'vitest';
import { ToolRegistry } from '../src/core/tool-registry';
import type { Tool } from '../src/core/types';

const tool = (name: string, description = name): Tool => ({ name, description, inputSchema: {}, source: 'mcp', effect: 'read', run: async () => ({ type: 'text', text: '' }) });

describe('the tool registry', () => {
  it('lets a tool replace the one with its own name', () => {
    const registry = new ToolRegistry().with([tool('web.search', 'plain'), tool('web.search', 'asking first')]);
    expect(registry.get('web__search')?.description).toBe('asking first');
  });

  it('leaves out another tool whose wire name is taken, keeping the first', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Server "a" with tool "b__c", and server "a__b" with tool "c": both mcp__a__b__c.
    const registry = new ToolRegistry().with([tool('mcp.a.b__c'), tool('mcp.a__b.c')]);
    expect(registry.list().map((t) => t.name)).toEqual(['mcp.a.b__c']);
    // Two names cut to the same 64 characters.
    const long = 'mcp.s.' + 'x'.repeat(70);
    expect(new ToolRegistry().with([tool(long + '1'), tool(long + '2')]).list().map((t) => t.name)).toEqual([long + '1']);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
