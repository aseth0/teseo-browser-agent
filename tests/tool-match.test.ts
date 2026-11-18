// Which tool groups reach the model for a message (Settings → Tools → Matching, tools/match): the
// default changes nothing; Recommended names the matching groups with the message; Only matching holds
// the others for tools.load, which lists them; a group offered once stays offered.
import { describe, expect, it, vi } from 'vitest';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { ToolRegistry, toWireName } = await import('../src/core/tool-registry');
const { LOAD_TOOL, withOnDemand } = await import('../src/tools/load');
const { alwaysGroups, decideToolMatch, heldFor, heldGroups, matchGroups, recommendationItem, scoreGroups, groupModes, matchingTools, toolMatchMode, toolMatchThreshold, wordCuts, reachesWords, TOOL_MATCH_THRESHOLD } = await import('../src/tools/match');
const { turnToolMatch, toolMatchNote } = await import('../src/tools/match-turn');
const { pieceLabel } = await import('../src/context/pieces');
const { loop } = await import('./helpers');
type Message = import('../src/core/types').Message;
type Tool = import('../src/core/types').Tool;
type Settings = import('../src/storage/settings').Settings;

const tool = (name: string, description: string, source: Tool['source'], group?: string): Tool => ({
  name, description, inputSchema: {}, source, effect: 'read', ...(group && { group }), run: async () => ({ type: 'text', text: `ran ${name}` }),
});
const TOOLS = [
  tool('browser.click', 'Clicks an element of the page.', 'browser'),
  tool('user.ask', 'Asks the user questions.', 'user'),
  tool('agents.ask', 'Asks another agent.', 'agent'),
  tool('web.search', 'Searches the web with the search engine and returns the results.', 'web'),
  tool('web.read', 'Reads a web page by its URL.', 'web'),
  tool('bookmarks.search', 'Searches the browser bookmarks by title or address.', 'bookmarks'),
  tool('mcp.tracker.create_issue', 'Creates an issue in the tracker.', 'mcp', 'mcp:tracker'),
  tool('mcp.tracker.list_issues', 'Lists the issues of a project.', 'mcp', 'mcp:tracker'),
  tool('custom.weather', 'Gets the weather forecast for a city.', 'custom', 'custom:Weather'),
  tool('custom_tools.read', 'Reads a custom tool.', 'custom'),
];
const ask = (text: string, extra: Partial<Message> = {}): Message => ({ role: 'user', parts: [{ type: 'text', text }], ...extra });
const groups = matchGroups(TOOLS);
const settings = (match?: object) => ({ providers: [], systemPrompt: '', tools: { match } }) as unknown as Settings;
const decide = (text: string, over: Partial<Parameters<typeof decideToolMatch>[0]> = {}) =>
  decideToolMatch({ mode: 'matching', threshold: TOOL_MATCH_THRESHOLD, typed: text, groups, always: alwaysGroups(TOOLS, groups), history: [ask(text)], mentioned: [], reference: matchGroups(TOOLS, new Set(), { every: true }), ...over });
const outcomes = (m: ReturnType<typeof decide>) => Object.fromEntries(m.groups.map((g) => [g.id, g.outcome]));

describe('the groups matched', () => {
  it('are web, history, bookmarks, each custom section and each MCP server, never the tools the loop needs', () => {
    expect(groups.map((g) => g.id).sort()).toEqual(['bookmarks', 'custom:Weather', 'mcp:tracker', 'web']);
    // The tools that manage custom tools are not matched: they stay offered.
    expect(groups.flatMap((g) => g.tools)).not.toContain('custom_tools.read');
    expect(alwaysGroups(TOOLS, groups).sort()).toEqual(['agents', 'browser', 'custom', 'user']);
    // A server already on demand keeps its own line in tools.load.
    expect(matchGroups(TOOLS, new Set(['mcp:tracker'])).map((g) => g.id)).not.toContain('mcp:tracker');
  });

  it('match by their label, their tools’ names as words and their descriptions', () => {
    const tracker = groups.find((g) => g.id === 'mcp:tracker')!;
    expect(tracker.label).toBe('MCP · tracker');
    expect(tracker.names).toBe('create issue\nlist issues');
    expect(outcomes(decide('create an issue for this bug'))).toMatchObject({ 'mcp:tracker': 'matched', web: 'held', bookmarks: 'held', 'custom:Weather': 'held' });
    expect(outcomes(decide('what is the weather forecast in Lisbon?'))['custom:Weather']).toBe('matched');
  });

  it('pass by their meaning too, when given', () => {
    const meaning = { cut: { matching: 0.55, recommend: 0.65 }, scores: new Map([['web', 0.7], ['bookmarks', 0.2]]) };
    const m = decide('find me cheap flights', { meaning });
    expect(outcomes(m)).toMatchObject({ web: 'matched', bookmarks: 'held' });
    expect(m.groups.find((g) => g.id === 'web')).toMatchObject({ meaning: 70 });
  });
});

describe('matching by words', () => {
  const server = (name: string, tools: [string, string][]) => tools.map(([t, d]) => tool(`mcp.${name}.${t}`, d, 'mcp', `mcp:${name}`));
  const TASKS = server('tasks', [['complete_tasks', 'Completes tasks by id.'], ['find_tasks', 'Finds tasks by text.'], ['add_tasks', 'Adds tasks to a project, such as a meeting to prepare.']]);
  // A large server whose tools are about something else, one of them naming meetings in passing.
  const AUTOMATION = server('automation', [
    ['find_connectors', 'Finds connectors such as a calendar, which reads your meetings.'],
    ...Array.from({ length: 30 }, (_, i): [string, string] => [`find_drafts_${i}`, `Finds automation drafts and runs, page ${i}.`]),
  ]);
  const both = matchGroups([...TASKS, ...AUTOMATION]);
  const match = (text: string) => Object.fromEntries(scoreGroups(text, both).map((r) => [r.group.id, Math.round(r.match * 100)]));

  it('do not take one shared word, in a message of words no tool has, for a full match', () => {
    // A message in another language than the tools' descriptions: only "meeting" is shared.
    expect(match('¿Qué te recomienda si te pido crear una nueva Meeting?')['mcp:automation']).toBeLessThan(TOOL_MATCH_THRESHOLD);
    expect(match('add a meeting task')['mcp:tasks']).toBeGreaterThanOrEqual(TOOL_MATCH_THRESHOLD);
  });

  it('go by the best tool of a group, which a large group gains nothing from, and name the tools that match first', () => {
    const r = scoreGroups('add tasks for a meeting', both);
    const tasks = r.find((g) => g.group.id === 'mcp:tasks')!;
    expect(tasks.tools[0]).toBe('mcp.tasks.add_tasks');
    expect(tasks.match).toBeGreaterThan(r.find((g) => g.group.id === 'mcp:automation')!.match);
    const m = decideToolMatch({ mode: 'recommend', threshold: TOOL_MATCH_THRESHOLD, typed: 'add tasks for a meeting', groups: both, always: [], history: [ask('add tasks for a meeting')], mentioned: [] });
    expect(recommendationItem(m, both)!.text).toContain('- MCP · tasks: mcp__tasks__add_tasks, ');
    expect(m.groups.find((g) => g.id === 'mcp:tasks')!.tools![0]).toBe('mcp.tasks.add_tasks');
  });
});

describe('the tools of a group, best first', () => {
  // A server whose tool names start with its own name, as many do; the message names the server.
  const PLANNER = matchGroups([
    tool('mcp.planner.planner-search', 'Search everything by text.', 'mcp', 'mcp:planner'),
    tool('mcp.planner.planner-add-projects', 'Create new projects.', 'mcp', 'mcp:planner'),
    tool('mcp.planner.planner-complete-tasks', 'Mark tasks as completed.', 'mcp', 'mcp:planner'),
    tool('mcp.planner.planner-find-projects', 'List or search the projects of the user, with their ids and names.', 'mcp', 'mcp:planner'),
  ]);
  it('are not all matched by the server\u2019s name, which every one of them has', () => {
    const [r] = scoreGroups('how many projects do I have in planner?', PLANNER);
    expect(r!.match).toBeGreaterThan(0); // the server's name still counts for the group
    expect(r!.tools.slice(0, 2).sort()).toEqual(['mcp.planner.planner-add-projects', 'mcp.planner.planner-find-projects']);
    expect(r!.tools).not.toContain('mcp.planner.planner-search');
    // In another language than the descriptions, only the server's name is shared: no tool by words.
    expect(scoreGroups('¿cuántos proyectos tengo en planner?', PLANNER)[0]!.tools).toEqual([]);
  });
  it('go by meaning when it is known, the closest first', () => {
    const meaning = { cut: { matching: 0.55, recommend: 0.6 }, scores: new Map([['mcp:planner', 0.63]]), tools: new Map([['mcp.planner.planner-search', 0.5], ['mcp.planner.planner-add-projects', 0.58], ['mcp.planner.planner-complete-tasks', 0.4], ['mcp.planner.planner-find-projects', 0.63]]) };
    const r = scoreGroups('¿cuántos proyectos tengo en planner?', PLANNER, meaning)[0]!;
    expect(matchingTools(r, meaning)).toEqual(['mcp.planner.planner-find-projects', 'mcp.planner.planner-add-projects']);
  });
});

describe('Only matching', () => {
  it('offers them all for a message that points at no tool, recommending none: it fails towards offering', () => {
    const m = decide('hello there');
    expect(m.groups.every((g) => g.outcome === 'unsure')).toBe(true);
    expect(m.unsure).toBe(true);
    expect(heldGroups(m, groups)).toEqual([]);
    expect(decide('hello there', { mode: 'recommend' }).groups.every((g) => g.outcome === 'unmatched')).toBe(true);
  });

  it('holds them back for a message that points at another tool (the browser\u2019s), all of them listed in tools.load', () => {
    const m = decide('click the element of the page');
    expect(m.groups.every((g) => g.outcome === 'held')).toBe(true);
    const opts = loop({ listModels: async () => [], chat: async function* () {} }, new ToolRegistry().with(TOOLS));
    const held = heldGroups(m, groups);
    const offered = withOnDemand(opts, [ask('click the element of the page')], [], held);
    const names = offered.tools.registry.list().map((t) => t.name);
    expect(names).toEqual(['browser.click', 'user.ask', 'agents.ask', 'custom_tools.read', LOAD_TOOL]);
    const load = offered.tools.registry.list().find((t) => t.name === LOAD_TOOL)!;
    expect(load.description).toContain('- web: Web (search and read) (web__search, web__read)');
    expect(load.description).toContain('- mcp:tracker: the 2 tools of the MCP server tracker (create_issue, list_issues)');
    expect(load.description).toContain('- custom:Weather: Weather (custom__weather)');
  });

  it('offers a group the message mentions a tool of, offered before, or loaded', () => {
    expect(outcomes(decide('hello', { mentioned: ['web.read'] })).web).toBe('mentioned');
    const before: Message = ask('search the web', { toolMatch: decide('search the web') });
    expect(before.toolMatch!.groups.find((g) => g.id === 'web')!.outcome).toBe('matched');
    expect(outcomes(decide('ok, go on', { history: [before, { role: 'assistant', parts: [{ type: 'text', text: 'Done.' }] }, ask('ok, go on')] })).web).toBe('earlier');
    const loaded: Message[] = [
      ask('hello'),
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'l1', name: toWireName(LOAD_TOOL), args: { groups: ['bookmarks'] } }] },
      { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'l1', content: 'ok' }] },
      ask('and now?'),
    ];
    expect(outcomes(decide('and now?', { history: loaded })).bookmarks).toBe('loaded');
  });

  it('keeps what was matched, loaded or used, never what was offered only because nothing stood out', () => {
    const greeting: Message = ask('hello there', { toolMatch: decide('hello there') });
    expect(greeting.toolMatch!.groups.every((g) => g.outcome === 'unsure')).toBe(true);
    const after = [greeting, { role: 'assistant', parts: [{ type: 'text', text: 'Hi!' }] } as Message, ask('click the element of the page')];
    expect(Object.values(outcomes(decide('click the element of the page', { history: after })))).toEqual(['held', 'held', 'held', 'held']);
    // A tool of the tracker was called: a short follow-up keeps it offered.
    const used: Message[] = [
      ask('create an issue'),
      { role: 'assistant', parts: [{ type: 'tool_call', id: 'c1', name: toWireName('mcp.tracker.create_issue'), args: {} }] },
      { role: 'tool', parts: [{ type: 'tool_result', toolCallId: 'c1', content: 'ok' }] },
      ask('click the element of the page'),
    ];
    expect(outcomes(decide('click the element of the page', { history: used }))['mcp:tracker']).toBe('used');
  });

  it('is what the previews hold back, from the decision kept in the message', () => {
    const history = [ask('create an issue', { toolMatch: decide('create an issue') })];
    expect(heldFor(history, TOOLS, []).map((g) => g.id).sort()).toEqual(['bookmarks', 'custom:Weather', 'web']);
    expect(heldFor([ask('create an issue')], TOOLS, [])).toEqual([]);
  });
});

describe('Recommended', () => {
  it('names the groups that match with the message, and holds nothing back', () => {
    const m = decide('create an issue in the tracker', { mode: 'recommend' });
    expect(outcomes(m)).toMatchObject({ 'mcp:tracker': 'matched', web: 'unmatched' });
    expect(heldGroups(m, groups)).toEqual([]);
    const item = recommendationItem(m, groups)!;
    expect(item.text).toBe('Tool groups that match this message:\n- MCP · tracker: mcp__tracker__create_issue, mcp__tracker__list_issues\nPrefer their tools for this task; the others stay available.');
    expect(pieceLabel({ type: 'text', text: item.text, context: 'tool', source: item.source })).toBe('Tools recommended · MCP · tracker');
    expect(recommendationItem(decide('hello', { mode: 'recommend' }), groups)).toBeUndefined();
  });
});

describe('the match by words a group needs', () => {
  it('is reached by the message\u2019s best match whenever that one passes the floor, also when it does so only once rounded', () => {
    expect(wordCuts(0.394, 40)).toBeUndefined();
    for (let best = 0.395; best <= 1; best += 0.001) {
      const cuts = wordCuts(best, 40)!;
      expect(reachesWords(best, cuts.matching), String(best)).toBe(true);
      expect(reachesWords(best, cuts.recommend), String(best)).toBe(true);
    }
    // 39.9% is shown as 40%, the match needed: it passes, and one shown as 39% does not.
    expect(reachesWords(0.399, wordCuts(0.399, 40)!.matching)).toBe(true);
    expect(reachesWords(0.394, 0.4)).toBe(false);
  });
});

describe('a server\u2019s own description', () => {
  const about = new Map([['mcp:tracker', 'Para: incidencias, errores, fallos del proyecto']]);
  it('is matched with its tools by words, in its own language, and never offered as a tool', () => {
    const withAbout = matchGroups(TOOLS, new Set(), { about });
    const tracker = withAbout.find((g) => g.id === 'mcp:tracker')!;
    expect(tracker.tools).toEqual(['mcp.tracker.create_issue', 'mcp.tracker.list_issues']);
    expect(tracker.each.map((t) => t.name)).toContain('mcp:tracker#about');
    const reference = matchGroups(TOOLS, new Set(), { every: true, about });
    const d = decideToolMatch({ mode: 'matching', threshold: TOOL_MATCH_THRESHOLD, typed: 'apunta este fallo', groups: withAbout, always: [], history: [ask('apunta este fallo')], mentioned: [], reference });
    expect(d.groups.find((g) => g.id === 'mcp:tracker')).toMatchObject({ outcome: 'matched' });
    expect(d.groups.find((g) => g.id === 'mcp:tracker')!.tools ?? []).not.toContain('mcp:tracker#about');
    // Without it, the Spanish message shares no word with the tools: nothing stands out.
    expect(decide('apunta este fallo').unsure).toBe(true);
  });
});

describe('the setting', () => {
  it('is All tools by default and for a mode it does not know, with nothing matched', async () => {
    expect(toolMatchMode(settings())).toBe('all');
    expect(toolMatchMode(settings({ mode: 'later-mode' }))).toBe('all');
    expect(toolMatchThreshold(settings())).toBe(40);
    const turn = await turnToolMatch({ settings: settings(), tools: TOOLS, history: [ask('create an issue')], mentioned: [], onDemand: [], meaningOn: async () => false });
    expect(turn).toEqual({ held: [] });
  });

  it('lets each server choose its own mode, over the setting, or leaves one on demand out', async () => {
    const servers = (mode: string | undefined, matching?: string, onDemand?: boolean) =>
      ({ ...settings(mode ? { mode } : undefined), mcpServers: [{ id: 't', name: 'tracker', url: 'https://mcp.example.com', enabled: true, ...(matching && { matching }), ...(onDemand && { onDemand }) }] }) as unknown as Settings;
    const turn = (s: Settings, text = 'hello') => turnToolMatch({ settings: s, tools: TOOLS, history: [ask(text)], mentioned: [], onDemand: [], meaningOn: async () => false });
    // Always offered, with the setting at Only matching: never held, the others are, for a message about the browser.
    const always = await turn(servers('matching', 'always'), 'click the element of the page');
    expect(always.held.map((g) => g.id).sort()).toEqual(['bookmarks', 'custom:Weather', 'web']);
    expect(always.match!.always).toContain('mcp:tracker');
    // Only when it matches, with the setting at All tools: the server alone is matched; held for a message about
    // another tool (the web's, offered to all), offered for one that points at none.
    const only = await turn(servers(undefined, 'matching'), 'search the web for a cheap lamp');
    expect(only.match!.groups.map((g) => [g.id, g.mode, g.outcome])).toEqual([['mcp:tracker', 'matching', 'held']]);
    expect(only.held.map((g) => g.id)).toEqual(['mcp:tracker']);
    expect((await turn(servers(undefined, 'matching'))).match!.groups[0]!.outcome).toBe('unsure');
    // Recommended when it matches, the setting at Only matching: recommended, never held.
    const rec = await turn(servers('matching', 'recommend'), 'create an issue');
    expect(rec.match!.groups.find((g) => g.id === 'mcp:tracker')).toMatchObject({ mode: 'recommend', outcome: 'matched' });
    expect(rec.item!.text).toContain('- MCP · tracker: mcp__tracker__create_issue');
    expect(rec.held.map((g) => g.id)).not.toContain('mcp:tracker');
    // On demand wins, and with nothing else to match, nothing is done.
    expect(await turn(servers(undefined, 'matching', true))).toEqual({ held: [] });
    expect(groupModes(servers('recommend', 'always'))('mcp:tracker')).toBe('all');
    expect(groupModes(servers('recommend'))('web')).toBe('recommend');
  });

  it('decides a turn by words with meaning off, and says what it decided', async () => {
    const turn = await turnToolMatch({ settings: settings({ mode: 'matching' }), tools: TOOLS, history: [ask('create an issue')], mentioned: [], onDemand: [], meaningOn: async () => false });
    expect(turn.match).toMatchObject({ mode: 'matching', threshold: 40 });
    expect(turn.held.map((g) => g.id).sort()).toEqual(['bookmarks', 'custom:Weather', 'web']);
    expect(turn.item).toBeUndefined();
  });

  it('is summed up for the turn\u2019s phase', async () => {
    const turn = await turnToolMatch({ settings: settings({ mode: 'matching' }), tools: TOOLS, history: [ask('create an issue')], mentioned: [], onDemand: [], meaningOn: async () => false });
    expect(toolMatchNote(turn)).toBe('1 offered, 3 held');
    const rec = await turnToolMatch({ settings: settings({ mode: 'recommend' }), tools: TOOLS, history: [ask('create an issue')], mentioned: [], onDemand: [], meaningOn: async () => false });
    expect(toolMatchNote(rec)).toBe('1 recommended, 0 held');
    expect(toolMatchNote({ held: [] })).toBe('nothing to match');
  });
});
