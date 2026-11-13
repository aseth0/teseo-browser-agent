// Tools offered on demand: instead of them, tools.load, with a line for each group; once the model loads
// a group its tools are offered from its next step on, for the rest of the conversation (loaded once:
// the tools offered change once, and the server's prompt cache breaks once). The groups:
// - create (Settings → Tools → Tools that create things on demand): for Browser (as the chat, and when
//   another agent asks it), with Builder off, the tools that create things, which take about half of
//   what the tools' definitions take in every request; and with them the skills that guide them (left
//   out of the system prompt's skills until then, heldSkills) and templates.run's drafts (until then it
//   runs saved templates only, TRIMMED);
// - mcp:<server> (Settings → MCP servers → Its tools on demand): a server's tools, for every agent.
import { CREATE_SKILLS, CREATE_TOOLS } from '../core/builder-ids';
import type { LoopOptions } from '../core/agent-loop';
import { stripMarks, text, type TextId } from '../core/model-texts';
import { toolGroup } from '../core/tool-groups';
import { toWireName, type ToolRegistry } from '../core/tool-registry';
import type { Message, Tool } from '../core/types';
import { mcpGroup } from '../core/mcp-keys';
import type { Settings } from '../storage/settings';
import { createOnDemand } from '../storage/settings-select';
import { fields } from './define';

export const LOAD_TOOL = 'tools.load';
const SKILLS_LOAD = 'skills.load';
// A tool offered smaller until its group is loaded: some parameters only named (each says to load the
// group, and a call with one is refused saying so), with a description of its own (`text`).
interface Trimmed {
  stub: string[];
  text: TextId;
}
// templates.run: saved templates only, its draft views (`views`, most of its definition) with create.
export const TRIMMED: Record<string, Trimmed> = { 'templates.run': { stub: ['views'], text: 'tools.templates_run_saved' } };

interface OnDemandGroup {
  id: string;
  tools: readonly string[]; // by their dotted names
  what: () => string; // its line in tools.load's description (TEXT_DEFS tools.load_*), as the user has it now
  skills?: string[]; // the skills that come with it: named with its line and when it is loaded
  trimmed?: string[]; // tools offered trimmed until it is loaded (TRIMMED), by their dotted names
}
type Listed = Pick<Tool, 'name' | 'source' | 'group'>;

const CREATE: OnDemandGroup = { id: 'create', tools: CREATE_TOOLS, what: () => text('tools.load_create'), trimmed: Object.keys(TRIMMED) };

// What a group's line and its loaded reply add about its skills.
const skillsLine = (skills: string[] | undefined) => (skills?.length ? ' ' + text('tools.load_skills', { skills: skills.join(', ') }) : '');
const SHOWN = 6; // tool names on an MCP server's line

// A server's group, from the tools it offers now (none: it offers none).
function mcpOnDemand(server: string, tools: Listed[]): OnDemandGroup[] {
  const own = tools.filter((t) => toolGroup(t) === mcpGroup(server)).map((t) => t.name);
  if (!own.length) return [];
  const names = own.map((n) => n.slice(`mcp.${server}.`.length));
  const what = () => {
    const listed = names.slice(0, SHOWN).join(', ') + (names.length > SHOWN ? text('tools.load_more', { count: String(names.length - SHOWN) }) : '');
    return own.length === 1 ? text('tools.load_mcp_one', { server, tools: listed }) : text('tools.load_mcp_many', { count: String(own.length), server, tools: listed });
  };
  return [{ id: mcpGroup(server), tools: own, what }];
}

// The groups on demand for an agent offered `tools`: `create` when it has it (agents/builtins hasCreateGroup), with
// those of its tools it is offered (none while Builder has them) and, when skills.load is offered, of
// its `skills` switched on those that guide them; and the servers' set so.
export function onDemandGroups(settings: Settings, tools: Listed[], { create, skills = [] }: { create: boolean; skills?: { name: string; enabled: boolean }[] }): OnDemandGroup[] {
  const servers = (settings.mcpServers ?? []).filter((s) => s.enabled && s.onDemand);
  const names = new Set(tools.map((t) => t.name));
  const own = CREATE.tools.filter((n) => names.has(n));
  const guides = names.has(SKILLS_LOAD) ? CREATE_SKILLS.filter((n) => skills.some((s) => s.enabled && s.name === n)) : [];
  return [...(create && createOnDemand(settings) && own.length ? [{ ...CREATE, tools: own, skills: guides }] : []), ...servers.flatMap((s) => mcpOnDemand(s.name, tools))];
}

// The skills the system prompt leaves out: those of the groups not loaded yet (the same groups
// withOnDemand holds back), which tools.load names instead.
export function heldSkills(groups: OnDemandGroup[], history: Message[]): string[] {
  const loaded = loadedGroups(history);
  return groups.filter((g) => !loaded.has(g.id)).flatMap((g) => g.skills ?? []);
}

// The groups a conversation loaded: by a tools.load call that went.
export function loadedGroups(history: Message[]): Set<string> {
  const failed = new Set(history.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_result' && p.isError ? [p.toolCallId] : []))));
  const calls = history.flatMap((m) => m.parts.flatMap((p) => (p.type === 'tool_call' && toWireName(p.name) === toWireName(LOAD_TOOL) && !failed.has(p.id) ? [p.args] : [])));
  return new Set(calls.flatMap((a) => groupsIn(a)));
}

const groupsIn = (args: unknown) => {
  const asked = fields(args).groups;
  return Array.isArray(asked) ? asked.filter((g): g is string => typeof g === 'string') : [];
};

// The tools left to load (for the tools menus' "on demand"): those of the groups not loaded yet.
export function onDemandNames(groups: OnDemandGroup[], history: Message[]): string[] {
  const loaded = loadedGroups(history);
  return groups.filter((g) => !loaded.has(g.id)).flatMap((g) => g.tools);
}

// With `extra` before the page's own tools, which go last (background/tool-catalog).
function beforePage(tools: ToolRegistry, extra: Tool[]): ToolRegistry {
  const page = tools.list().filter((t) => t.source === 'webmcp');
  return tools.without(page.map((t) => t.name)).with([...extra, ...page]);
}

// A tool as offered until its group (`group`) is loaded: its own description (not the tool's, nor
// an override of it), each stubbed parameter only its type and what to load, refused when given.
// `T`: a Tool, or a tool as the panel lists it (ToolInfo, without run).
function trimmedTool<T extends Pick<Tool, 'inputSchema'> & { run?: Tool['run'] }>(tool: T, group: string): T {
  const trim = TRIMMED[(tool as { name?: string }).name ?? '']!;
  const schema = tool.inputSchema as { properties?: Record<string, { type?: unknown }> };
  // Not marked: tool definitions are listed in the panel and are not colored anywhere.
  const first = (argument: string) => stripMarks(text('tools.load_first', { argument, group }));
  const properties = Object.fromEntries(Object.entries(schema.properties ?? {}).map(([k, v]) => [k, trim.stub.includes(k) ? { type: v.type, description: first(k) } : v]));
  const run = tool.run;
  return {
    ...tool,
    description: stripMarks(text(trim.text)),
    ownText: true,
    inputSchema: { ...tool.inputSchema, properties },
    ...(run && {
      run: (args: unknown, ctx: Parameters<Tool['run']>[1]) => {
        const given = trim.stub.find((k) => fields(args)[k] !== undefined && fields(args)[k] !== null);
        if (given) throw new Error(first(given));
        return run(args, ctx);
      },
    }),
  };
}

type Hidden = { names: string[]; what: () => string; skills?: string[]; trimmed: string[] };

function loadTool(groups: Map<string, Hidden>, onLoad: (groups: string[]) => void): Tool {
  const ids = [...groups.keys()];
  return {
    name: LOAD_TOOL,
    // Not marked: tool definitions are listed in the panel and are not colored anywhere.
    description: stripMarks(text('tools.load_description', { groups: [...groups].map(([id, g]) => text('tools.load_group', { id, what: g.what() + skillsLine(g.skills) })).join('\n') })),
    inputSchema: { type: 'object', properties: { groups: { type: 'array', items: { type: 'string', enum: ids } } }, required: ['groups'] },
    source: 'agent',
    effect: 'read',
    run: async (args) => {
      const asked = groupsIn(args).filter((g) => groups.has(g));
      if (!asked.length) throw new Error(`No such group: choose from ${ids.join(', ')}.`);
      onLoad(asked);
      const tools = asked.flatMap((g) => groups.get(g)!.names).map(toWireName);
      const skills = asked.flatMap((g) => groups.get(g)!.skills ?? []);
      return { type: 'text', text: text('result.tools_loaded', { group: asked.join(', '), tools: tools.join(', ') }) + skillsLine(skills) };
    },
  };
}

// The loop's options with the groups the conversation has not loaded left out (but the tools the
// user's message mentions, $tool), their trimmed tools offered trimmed (in their place), tools.load
// offered instead, and what it loads offered from the next step on. As they were when no tool of a
// group is offered (Builder on, or the user switched them off).
// The groups not loaded yet, with those of their tools offered (but the tools the user's message
// mentions, $tool): what is held back.
function hiddenGroups(groups: OnDemandGroup[], history: Message[], offered: Set<string>, mentioned: string[]): Map<string, Hidden> {
  const loaded = loadedGroups(history);
  const free = (n: string) => offered.has(n) && !mentioned.includes(n);
  return new Map(groups.flatMap(({ id, tools, what, skills, trimmed = [] }): [string, Hidden][] => {
    const names = tools.filter(free);
    return !loaded.has(id) && names.length ? [[id, { names, what, skills, trimmed: trimmed.filter(free) }]] : [];
  }));
}

// The tools a request is offered (for the previews, as withOnDemand offers them to the run): those
// held back left out, the trimmed ones trimmed in their place, and tools.load before the page's.
export function offeredOnDemand<T extends Pick<Tool, 'name' | 'source' | 'inputSchema'>>(tools: T[], history: Message[], groups: OnDemandGroup[]): (T | Tool)[] {
  const hidden = hiddenGroups(groups, history, new Set(tools.map((t) => t.name)), []);
  if (!hidden.size) return tools;
  const held = new Set([...hidden.values()].flatMap((g) => g.names));
  const trimmedBy = new Map([...hidden].flatMap(([id, g]) => g.trimmed.map((n) => [n, id] as const)));
  const kept = tools.filter((t) => !held.has(t.name)).map((t) => (trimmedBy.has(t.name) ? trimmedTool(t, trimmedBy.get(t.name)!) : t));
  return [...kept.filter((t) => t.source !== 'webmcp'), loadTool(hidden, () => undefined), ...kept.filter((t) => t.source === 'webmcp')];
}

export function withOnDemand(opts: LoopOptions, history: Message[], mentioned: string[], groups: OnDemandGroup[]): LoopOptions {
  const all = opts.tools.registry.list();
  const hidden = hiddenGroups(groups, history, new Set(all.map((t) => t.name)), mentioned);
  if (!hidden.size) return opts;
  const held = all.filter((t) => [...hidden.values()].some((g) => g.names.includes(t.name)));
  const trimmed = [...hidden].flatMap(([id, g]) => all.filter((t) => g.trimmed.includes(t.name)).map((t) => trimmedTool(t, id)));
  let asked: string[] = []; // loaded in this run, offered from the next step
  const onLoad = (ids: string[]) => (asked = [...asked, ...ids]);
  const load = () => loadTool(hidden, onLoad);
  const { refresh } = opts.tools;
  return {
    ...opts,
    tools: {
      ...opts.tools,
      // A trimmed tool keeps its place (ToolRegistry.with replaces it there).
      registry: beforePage(opts.tools.registry.without(held.map((t) => t.name)).with(trimmed), [load()]),
      refresh: async (tools) => {
        const page = refresh ? await refresh(tools) : undefined;
        if (!asked.length) return page;
        const names = asked.flatMap((id) => hidden.get(id)?.names ?? []);
        const untrimmed = asked.flatMap((id) => hidden.get(id)?.trimmed ?? []);
        for (const id of asked) hidden.delete(id);
        asked = [];
        const rest = hidden.size ? [load()] : [];
        return beforePage((page ?? tools).without([LOAD_TOOL]).with(all.filter((t) => untrimmed.includes(t.name))), [...held.filter((t) => names.includes(t.name)), ...rest]);
      },
    },
  };
}
