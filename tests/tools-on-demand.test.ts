import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { CREATE_TOOLS } = await import('../src/core/builder-ids');
const { runAgentLoop } = await import('../src/core/agent-loop');
const { stripMarks, text } = await import('../src/core/model-texts');
const { ToolRegistry, toWireName } = await import('../src/core/tool-registry');
const { heldSkills, LOAD_TOOL, loadedGroups, offeredOnDemand, onDemandGroups, onDemandNames, withOnDemand } = await import('../src/tools/load');
const { createOnDemand } = await import('../src/storage/settings-select');
const { collect, loop, scripted, TOOL_SETTINGS } = await import('./helpers');
type Message = import('../src/core/types').Message;
type LoopOptions = import('../src/core/agent-loop').LoopOptions;

// Default is offered tools.load instead of the tools that create things; once loaded they are offered from the next step on.
const tool = (name: string) => ({ name, description: name, inputSchema: {}, source: 'skill' as const, effect: 'write' as const, run: async () => ({ type: 'text' as const, text: `ran ${name}` }) });
const registry = (names: string[]) => {
  const r = new ToolRegistry();
  for (const n of names) r.register(tool(n));
  return r;
};
const all = registry(['browser.find', 'skills.read', ...CREATE_TOOLS]);
const ask: Message = { role: 'user', parts: [{ type: 'text', text: 'make a skill' }] };
const loadCall = (id: string, groups: unknown): Message[] => [
  { role: 'assistant', parts: [{ type: 'tool_call', id, name: toWireName(LOAD_TOOL), args: { groups } }] },
  { role: 'tool', parts: [{ type: 'tool_result', toolCallId: id, content: 'ok' }] },
];
const names = (o: LoopOptions) => o.tools.registry.list().map((t) => t.name);

const settings = { providers: [], systemPrompt: '' };
const create = onDemandGroups(settings, all.list(), { create: true });

describe('the tools that create things on demand', () => {
  const opts = loop({ listModels: async () => [], chat: async function* () {} }, all);

  it('are left out, with tools.load instead, until the conversation loads them', () => {
    const fresh = withOnDemand(opts, [ask], [], create);
    expect(names(fresh)).toEqual(['browser.find', 'skills.read', LOAD_TOOL]);
    expect(fresh.tools.registry.list().at(-1)!.description).toContain('- create: save, try, edit and delete skills');
    expect(withOnDemand(opts, [ask, ...loadCall('l1', ['create'])], [], create)).toBe(opts);
    // One the message mentions goes as it is; nothing of the group offered (Builder on): nothing changes.
    expect(names(withOnDemand(opts, [ask], ['skills.save'], create))).toContain('skills.save');
    const none = { ...opts, tools: { ...opts.tools, registry: registry(['browser.find']) } };
    expect(withOnDemand(none, [ask], [], create)).toBe(none);
    // Builder on: Default is not offered them, so it has no such group at all.
    expect(onDemandGroups(settings, registry(['browser.find']).list(), { create: true })).toEqual([]);
  });

  it('count as loaded only by a call that went, with a list of groups', () => {
    expect(loadedGroups([ask, ...loadCall('l1', ['create'])])).toEqual(new Set(['create']));
    expect(loadedGroups([ask, ...loadCall('l2', 'create')])).toEqual(new Set());
    const failed = loadCall('l3', ['create']);
    (failed[1]!.parts[0] as { isError?: boolean }).isError = true;
    expect(loadedGroups([ask, ...failed])).toEqual(new Set());
    expect(createOnDemand({ providers: [], systemPrompt: '' })).toBe(true);
    expect(createOnDemand({ providers: [], systemPrompt: '', tools: { createOnDemand: false } })).toBe(false);
  });

  it('are offered from the step after tools.load, and tools.load no longer', async () => {
    const provider = scripted([
      [{ type: 'tool-call', id: 'c1', name: 'tools__load', args: { groups: ['create'] } }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'tool-call', id: 'c2', name: 'skills__save', args: {} }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Saved' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const { requests } = provider;
    const events = await collect(runAgentLoop([ask], withOnDemand({ ...opts, model: { ...opts.model, provider } }, [ask], [], create), new AbortController().signal));
    const offered = requests.map((r) => (r.tools ?? []).map((t) => t.name));
    expect(offered[0]).toContain('tools__load');
    expect(offered[0]).not.toContain('skills__save');
    expect(offered[1]).toContain('skills__save');
    expect(offered[1]).not.toContain('tools__load');
    const results = events.flatMap((e) => (e.type === 'message' && e.message.role === 'tool' ? e.message.parts : []));
    expect(results[0]).toMatchObject({ content: text('result.tools_loaded', { group: 'create', tools: CREATE_TOOLS.map(toWireName).join(', ') }) });
    expect(results[1]).toMatchObject({ content: 'ran skills.save' });
  });

  it('bring the skills that guide them, named with their line and once loaded, while skills.load is offered', async () => {
    const skills = [{ name: 'create-skill', enabled: true }, { name: 'create-agent', enabled: false }, { name: 'fill-form', enabled: true }];
    const withLoad = registry(['browser.find', 'skills.load', ...CREATE_TOOLS]);
    const groups = onDemandGroups(settings, withLoad.list(), { create: true, skills });
    expect(groups[0]!.skills).toEqual(['create-skill']);
    const sent = withOnDemand({ ...opts, tools: { ...opts.tools, registry: withLoad } }, [ask], [], groups);
    const load = sent.tools.registry.get(toWireName(LOAD_TOOL))!;
    const line = text('tools.load_skills', { skills: 'create-skill' });
    expect(load.description).toContain(stripMarks(line));
    const reply = await load.run({ groups: ['create'] }, { settings: TOOL_SETTINGS, signal: new AbortController().signal });
    expect(reply).toMatchObject({ text: `${text('result.tools_loaded', { group: 'create', tools: CREATE_TOOLS.map(toWireName).join(', ') })} ${line}` });
    // None of them on, or no skills.load to load them with: nothing said of them.
    expect(onDemandGroups(settings, withLoad.list(), { create: true })[0]!.skills).toEqual([]);
    expect(onDemandGroups(settings, all.list(), { create: true, skills })[0]!.skills).toEqual([]);
  });

  it('keep templates.run to saved templates, in its place, its drafts refused saying what to load', async () => {
    const { templateTools } = await import('../src/templates/tools');
    const { execute } = await import('../src/core/tool-exec');
    const run = templateTools().find((t) => t.name === 'templates.run')!;
    const r = new ToolRegistry();
    for (const t of [tool('browser.find'), run, ...CREATE_TOOLS.map(tool)]) r.register(t);
    const withRun = { ...opts, tools: { ...opts.tools, registry: r } };
    const groups = onDemandGroups(settings, r.list(), { create: true });
    const sent = withOnDemand(withRun, [ask], [], groups);
    expect(names(sent)).toEqual(['browser.find', 'templates.run', LOAD_TOOL]);
    const trimmed = sent.tools.registry.get(toWireName('templates.run'))!;
    const props = (trimmed.inputSchema as { properties: Record<string, { type: string; description: string; items?: unknown }> }).properties;
    // The real schema's draft parameter, only named: a rename would leave it whole (and this fails).
    const first = stripMarks(text('tools.load_first', { argument: 'views', group: 'create' }));
    expect(props.views).toEqual({ type: 'array', description: first });
    expect(Object.keys(props)).toEqual(Object.keys((run.inputSchema as { properties: object }).properties));
    expect(trimmed.description).toBe(stripMarks(text('tools.templates_run_saved')));
    expect(JSON.stringify(sent.tools.registry.specs()).length).toBeLessThan(JSON.stringify(r.specs()).length);
    // A draft given anyway: refused, saying to load the group.
    const ctx = { signal: new AbortController().signal, settings: TOOL_SETTINGS, tabId: 1 } as never;
    const res = await execute(sent, sent.tools.registry, toWireName('templates.run'), { views: [{ name: 'a', template: 'x' }], view: 'a' }, ctx);
    expect(res).toMatchObject({ isError: true });
    expect(res.content).toContain(first);
    // A description you changed for templates.run does not replace its own.
    const { setTextOverrides } = await import('../src/core/model-texts');
    setTextOverrides({ 'tool:templates.run': 'Mine, with views.' });
    expect(sent.tools.registry.specs().find((t) => t.name === toWireName('templates.run'))!.description).toBe(text('tools.templates_run_saved'));
    setTextOverrides({});
    await sent.tools.registry.get(toWireName(LOAD_TOOL))!.run({ groups: ['create'] }, { settings: TOOL_SETTINGS, signal: new AbortController().signal });
    const next = (await sent.tools.refresh!(sent.tools.registry))!;
    expect(next.get(toWireName('templates.run'))).toBe(run);
    expect(next.list().map((t) => t.name).indexOf('templates.run')).toBe(1);
    // Mentioned ($templates.run), or the group loaded before: whole.
    expect(withOnDemand(withRun, [ask], ['templates.run'], groups).tools.registry.get(toWireName('templates.run'))).toBe(run);
    expect(withOnDemand(withRun, [ask, ...loadCall('l1', ['create'])], [], groups)).toBe(withRun);
    // The previews offer the same.
    expect(offeredOnDemand(r.list(), [ask], groups).map((t) => t.name)).toEqual(names(sent));
  });

  it('offer a trimmed tool without origin marks, while the extension marks the values of its texts', async () => {
    const { templateTools } = await import('../src/templates/tools');
    const { execute } = await import('../src/core/tool-exec');
    const { setValueMarking } = await import('../src/core/model-texts');
    const r = new ToolRegistry();
    for (const t of [templateTools().find((t) => t.name === 'templates.run')!, ...CREATE_TOOLS.map(tool)]) r.register(t);
    setValueMarking(true); // as the background runs
    try {
      const sent = withOnDemand({ ...opts, tools: { ...opts.tools, registry: r } }, [ask], [], onDemandGroups(settings, r.list(), { create: true }));
      const marked = text('tools.load_first', { argument: 'views', group: 'create' });
      expect(stripMarks(marked)).not.toBe(marked);
      // Tool definitions go to the model as they are: a mark in one would reach it.
      expect(JSON.stringify(sent.tools.registry.specs())).not.toMatch(/[\uE000-\uF8FF]/);
      const ctx = { signal: new AbortController().signal, settings: TOOL_SETTINGS, tabId: 1 } as never;
      const res = await execute(sent, sent.tools.registry, toWireName('templates.run'), { views: [{ name: 'a', template: 'x' }] }, ctx);
      expect(res.content).toContain(stripMarks(marked));
    } finally {
      setValueMarking(false);
    }
  });
});

describe('an MCP server\'s tools on demand', () => {
  const mcp = (n: number) => Array.from({ length: n }, (_, i) => ({ ...tool(`mcp.jira.t${i + 1}`), source: 'mcp' as const, group: 'mcp:jira' }));
  const r = new ToolRegistry();
  for (const t of [tool('browser.find'), ...mcp(8), ...CREATE_TOOLS.map(tool)]) r.register(t);
  const jira = { providers: [], systemPrompt: '', mcpServers: [{ id: 's', name: 'jira', url: 'https://mcp.example.com', enabled: true, onDemand: true }] };
  const opts = loop({ listModels: async () => [], chat: async function* () {} }, r);

  it('go as a line of tools.load, with create, for every agent; off by default', () => {
    const groups = onDemandGroups(jira, r.list(), { create: true });
    expect(groups.map((g) => g.id)).toEqual(['create', 'mcp:jira']);
    expect(stripMarks(groups[1]!.what())).toBe('the 8 tools of the MCP server jira (t1, t2, t3, t4, t5, t6, … and 2 more)');
    const sent = withOnDemand(opts, [ask], [], groups);
    expect(names(sent)).toEqual(['browser.find', LOAD_TOOL]);
    expect(sent.tools.registry.list().at(-1)!.description).toContain('- mcp:jira: the 8 tools');
    // Another agent: only the server's; one server not on demand, or without tools here: none.
    expect(onDemandGroups(jira, r.list(), { create: false }).map((g) => g.id)).toEqual(['mcp:jira']);
    expect(onDemandGroups({ ...jira, mcpServers: [{ ...jira.mcpServers[0]!, onDemand: undefined }] }, r.list(), { create: false })).toEqual([]);
    expect(onDemandGroups(jira, [tool('browser.find')], { create: false })).toEqual([]);
  });

  it('loads one group of two: the other is still offered through tools.load', async () => {
    const groups = onDemandGroups(jira, r.list(), { create: true });
    const sent = withOnDemand(opts, [ask], [], groups);
    const load = sent.tools.registry.get(toWireName(LOAD_TOOL))!;
    await expect(load.run({ groups: ['nowhere'] }, { settings: TOOL_SETTINGS, signal: new AbortController().signal })).rejects.toThrow('No such group: choose from create, mcp:jira.');
    await load.run({ groups: ['mcp:jira'] }, { settings: TOOL_SETTINGS, signal: new AbortController().signal });
    const next = (await sent.tools.refresh!(sent.tools.registry))!;
    const offered = next.list().map((t) => t.name);
    expect(offered).toContain('mcp.jira.t1');
    expect(offered).not.toContain('skills.save');
    expect(next.get(toWireName(LOAD_TOOL))!.description).toContain('- create:');
    expect(next.get(toWireName(LOAD_TOOL))!.description).not.toContain('mcp:jira');
  });

  it('stay loaded, and go when mentioned', () => {
    const groups = onDemandGroups(jira, r.list(), { create: false });
    const after = withOnDemand(opts, [ask, ...loadCall('l1', ['mcp:jira'])], [], groups);
    expect(after).toBe(opts);
    expect(names(withOnDemand(opts, [ask], ['mcp.jira.t3'], groups))).toContain('mcp.jira.t3');
    expect(onDemandNames(groups, [ask])).toHaveLength(8);
    expect(onDemandNames(groups, [ask, ...loadCall('l1', ['mcp:jira'])])).toEqual([]);
  });

  it('has one tool said so', () => {
    expect(stripMarks(onDemandGroups(jira, mcp(1), { create: false })[0]!.what())).toBe('the tool of the MCP server jira (t1)');
  });
});

describe('the skills that guide the tools that create things', () => {
  const skill = (name: string) => ({ id: name, name, description: `${name} desc`, matches: [], body: '', references: [], enabled: true });
  const skills = [skill('create-skill'), skill('manage-creations'), skill('fill-form')];
  const withLoad = registry(['browser.find', 'skills.load', ...CREATE_TOOLS]).list();

  it('are left out of the system prompt exactly while their group is held back', async () => {
    const { buildSystemPrompt } = await import('../src/context/request');
    const sys = (held: string[]) => buildSystemPrompt({ settings, skills, templates: [], heldSkills: held });
    const groups = onDemandGroups(settings, withLoad, { create: true, skills });
    const held = heldSkills(groups, [ask]);
    expect(held).toEqual(['create-skill', 'manage-creations']);
    expect(sys(held)).toContain('fill-form');
    expect(sys(held)).not.toContain('create-skill');
    // Loaded in the conversation: listed again (a summary of those turns cannot lose them).
    expect(heldSkills(groups, [ask, ...loadCall('l1', ['create'])])).toEqual([]);
    // No group: Builder on (no tools that create things offered), another agent, or the switch off.
    expect(heldSkills(onDemandGroups(settings, registry(['browser.find', 'skills.load']).list(), { create: true, skills }), [ask])).toEqual([]);
    expect(heldSkills(onDemandGroups(settings, withLoad, { create: false, skills }), [ask])).toEqual([]);
    expect(heldSkills(onDemandGroups({ ...settings, tools: { createOnDemand: false } }, withLoad, { create: true, skills }), [ask])).toEqual([]);
    expect(sys([])).toContain('create-skill');
  });
});
