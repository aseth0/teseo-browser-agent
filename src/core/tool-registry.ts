import { toolDescription } from './model-texts';
import type { Tool, ToolSpec } from './types';

// APIs only accept ^[a-zA-Z0-9_-]{1,64}$ as function names,
// so "browser.click" travels as "browser__click".
export const toWireName = (name: string) => name.replace(/\./g, '__').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

// Tools by their dotted or wire name: the dotted one of those `names` that `written` is, if any.
export const toolNamed = (names: string[]) => (written: string) => names.find((n) => n === written || toWireName(n) === written);

// A name a page (WebMCP) or an MCP server gives its tool: it goes into the tool list, the tools menus'
// texts and the attributes of its result's block, so a tool with any other name is left out.
export const TOOL_NAME = /^[A-Za-z0-9_.-]{1,64}$/;

// Single catalog: browser, MCP, site adapters, WebMCP and skills register here.
export class ToolRegistry {
  private tools = new Map<string, Tool>(); // key = wire name

  // A tool replaces the one with its own name (e.g. web.search, asking first). Another tool whose
  // wire name is taken (mcp.a.b__c and mcp.a__b.c, or two cut to the same 64 characters) is left out:
  // its calls would go to the other one, under the other one's policy.
  register(tool: Tool): void {
    const wire = toWireName(tool.name);
    const taken = this.tools.get(wire);
    if (taken && taken.name !== tool.name) {
      console.warn(`[tools] ${tool.name} left out: its name is sent as ${wire}, as ${taken.name}'s is`);
      return;
    }
    this.tools.set(wire, tool);
  }

  get(wireName: string): Tool | undefined {
    return this.tools.get(wireName);
  }

  wireNames(): string[] {
    return [...this.tools.keys()];
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  // A view with extra tools (e.g. the ones the current page offers), for one run.
  with(extra: Tool[]): ToolRegistry {
    const view = new ToolRegistry();
    for (const t of [...this.tools.values(), ...extra]) view.register(t);
    return view;
  }

  // A view without the named tools (by their dotted name): what the model is offered.
  without(names: Iterable<string>): ToolRegistry {
    const excluded = new Set(names);
    const view = new ToolRegistry();
    for (const t of this.tools.values()) if (!excluded.has(t.name)) view.register(t);
    return view;
  }

  specs(): ToolSpec[] {
    return [...this.tools.entries()].map(([wire, t]) => {
      const description = t.ownText ? t.description : toolDescription(t.name, t.description);
      return { name: wire, description: t.fillDescription ? t.fillDescription(description) : description, inputSchema: t.inputSchema };
    });
  }
}
