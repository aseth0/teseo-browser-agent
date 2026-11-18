import { describe, expect, it, vi } from 'vitest';
import type { Message } from '../src/core/types';
import type { Settings } from '../src/storage/settings';
import { TOOL_SETTINGS } from './helpers';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());
const { askSpec, askTool, askToolFor, lastAnswer, withAsk } = await import('../src/agents/ask');
const { agentOffers, agentToolsFrom, callableAgents, newAgentProfile } = await import('../src/agents/profiles');

const mm = { ...newAgentProfile(), id: 'm', name: 'mattermost', description: 'Chats and channels', canBeAsked: true };
const wiki = { ...newAgentProfile(), id: 'w', name: 'wiki', description: '', canBeAsked: true };
const jira = { ...newAgentProfile(), id: 'j', name: 'jira', canAsk: true, canBeAsked: true };
const ctx = { settings: TOOL_SETTINGS, signal: new AbortController().signal, callId: 'c7' };

describe('who may ask whom', () => {
  it('one that can ask asks every other one that can be asked and is on, never itself; Browser, with its own setting', () => {
    const off = { ...newAgentProfile(), id: 'off', name: 'off', enabled: false, canBeAsked: true };
    const shy = { ...newAgentProfile(), id: 's', name: 'shy' };
    const all = [jira, mm, wiki, off, shy];
    expect(callableAgents(jira, all, {}).map((a) => a.name)).toEqual(['mattermost', 'wiki']);
    expect(callableAgents({ ...jira, canAsk: false }, all, {})).toEqual([]);
    expect(callableAgents(undefined, all, { defaultCanAsk: true } as Settings).map((a) => a.name)).toEqual(['jira', 'mattermost', 'wiki']);
    expect(callableAgents(undefined, all, {})).toEqual([]);
  });
  it('Browser can be asked when it says so, never by itself; asked, it has what is switched on', async () => {
    const { browserWith } = await import('../src/agents/builtins');
    const settings = { browserAgent: { canBeAsked: true, description: 'General help' }, defaultCanAsk: true } as Settings;
    const asked = callableAgents(jira, [jira, wiki], settings);
    expect(asked.map((a) => [a.name, a.description])).toEqual([['Browser', 'General help'], ['wiki', '']]);
    expect(callableAgents(undefined, [jira, wiki], settings).map((a) => a.name)).toEqual(['jira', 'wiki']);
    expect(callableAgents(jira, [jira, wiki], { browserAgent: {} }).map((a) => a.name)).toEqual(['wiki']);
    const browser = browserWith({ ...settings, disabledTools: ['web.search'] } as Settings, ['browser.find', 'web.search'], [{ name: 'a', enabled: true }, { name: 'b', enabled: false }], []);
    expect([browser.id, browser.tools, browser.skills, browser.onlyItsSites]).toEqual(['browser', ['browser.find'], ['a'], undefined]);
    expect(callableAgents(browser, [jira, wiki], settings).map((a) => a.name)).toEqual(['jira', 'wiki']);
  });
  it('agents.ask goes with an agent without being stored, and only with someone to ask', () => {
    const tools = [{ name: 'browser.find' }, { name: 'agents.ask' }];
    expect(agentOffers(jira, tools, []).map((t) => t.name)).toEqual(['agents.ask']);
    expect(agentToolsFrom(jira, ['agents.ask', 'browser.find'])).toEqual(['browser.find']);
    expect(withAsk(tools, []).map((t) => t.name)).toEqual(['browser.find']);
    expect(withAsk(tools, [mm])).toBe(tools);
  });
});

const ANSWER = '\n\nEnd your answer with two short lines:\nDid: what you did.\nNot done or not verified: what you could not do or check, or "nothing".';

describe('agents.ask', () => {
  it('lists those it may ask, by name, in its description and its schema', () => {
    const tool = askToolFor([mm, wiki], async () => ({ type: 'text', text: '' }));
    expect(tool.fillDescription!(askTool().description)).toMatch(/Agents you may ask:\n- mattermost: Chats and channels\n- wiki: \(no description\)$/);
    expect((tool.inputSchema as { properties: { agent: { enum: string[] } } }).properties.agent.enum).toEqual(['mattermost', 'wiki']);
    const spec = askSpec({ name: 'agents__ask', description: askTool().description, inputSchema: {} }, [mm]);
    expect(spec.description).toContain('- mattermost: Chats and channels');
  });
  it('asks the agent named with the task, naming the call', async () => {
    const ask = vi.fn(async () => ({ type: 'text' as const, text: 'answer' }));
    const tool = askToolFor([mm], ask);
    expect(await tool.run({ agent: 'mattermost', task: ' find the channel ' }, ctx)).toEqual({ type: 'text', text: 'answer' });
    expect(ask).toHaveBeenCalledWith(mm, `find the channel${ANSWER}`, 'c7');
  });
  it('lays out a full brief in sections, in their order, whatever order the call gives them', async () => {
    const ask = vi.fn(async () => ({ type: 'text' as const, text: 'answer' }));
    await askToolFor([mm], ask).run({ report: 'the link', done: 'one channel', agent: 'mattermost', constraints: 'post nothing', task: 'find the channel', context: 'not #general' }, ctx);
    expect(ask).toHaveBeenCalledWith(
      mm,
      `find the channel\n\n## Already known\nnot #general\n\n## Do not\npost nothing\n\n## Done when\none channel\n\n## Send back\nthe link${ANSWER}`,
      'c7',
    );
  });
  it('offers the brief fields after the agent and the task, only those two required', () => {
    const schema = askToolFor([mm], vi.fn()).inputSchema as { properties: Record<string, unknown>; required: string[] };
    expect(Object.keys(schema.properties)).toEqual(['agent', 'task', 'context', 'constraints', 'done', 'report']);
    expect(schema.required).toEqual(['agent', 'task']);
  });
  it('refuses an agent it may not ask, or no task', async () => {
    const ask = vi.fn();
    const tool = askToolFor([mm], ask);
    expect(await tool.run({ agent: 'jira', task: 'x' }, ctx)).toMatchObject({ isError: true, text: expect.stringContaining('No agent named "jira"') });
    expect(await tool.run({ agent: 'mattermost', task: ' ' }, ctx)).toMatchObject({ isError: true });
    expect(ask).not.toHaveBeenCalled();
  });
  it('answers with the text of the last reply', () => {
    const messages: Message[] = [
      { role: 'assistant', parts: [{ type: 'text', text: 'Looking…' }, { type: 'tool_call', id: '1', name: 'x', args: {} }] },
      { role: 'tool', parts: [{ type: 'tool_result', toolCallId: '1', content: 'r' }] },
      { role: 'assistant', parts: [{ type: 'reasoning', text: 'hmm' }, { type: 'text', text: 'It is #inc-1.' }] },
    ];
    expect(lastAnswer(messages)).toBe('It is #inc-1.');
    expect(lastAnswer([])).toBe('');
  });
});
