import { describe, expect, it, vi } from 'vitest';
import type { Tool, ToolResult } from '../src/core/types';
import { actionProblems, newAction, type WidgetAction } from '../src/widget/actions';
import { countOf, runSteps, short, type ActionStep, type StepRunner } from '../src/widget/steps';

vi.mock('wxt/browser', async () => (await import('./fakes/browser')).emptyBrowser());

const issue: Tool = {
  name: 'jira.issue',
  description: '',
  inputSchema: { type: 'object', properties: { key: { type: 'string' }, limit: { type: 'number' } } },
  source: 'custom',
  effect: 'read',
  run: async (): Promise<ToolResult> => ({ type: 'json', value: {} }),
};

const steps: ActionStep[] = [
  { name: 'page', read: '{{url}}', match: 'https?://(?<domain>[^/]+)/browse/(?<id>[A-Z]+-\\d+)' },
  { name: 'ticket', tool: 'jira.issue', args: { key: '{page.id}', limit: '3' }, extract: 'fields' },
  { name: 'triage', prompt: 'Triage {page.id}: {ticket.summary}', fields: { priority: ['High', 'Low'], urgent: 'boolean' } },
];
const action = (change: Partial<WidgetAction> = {}): WidgetAction => ({
  ...newAction(), id: 'a', name: 'Triage', tool: '', input: 'none', steps,
  outputs: [{ label: 'Priority', from: 'triage.priority' }, { label: 'Where', from: 'page.domain' }], badge: 'triage.urgent', ...change,
});
const values = { input: '', reads: { page: 'https://jira.example.com/browse/INC-1234' } };
const signal = new AbortController().signal;

describe('action steps', () => {
  it('passes values between steps, checks the fields and asks again once', async () => {
    const calls: Record<string, unknown>[] = [];
    const answers = ['{"priority": "Critical", "urgent": true}', '{"priority": "High", "urgent": true}'];
    const asked: string[] = [];
    const runner: StepRunner = {
      system: 'sys',
      runTool: async (_name, argsOf) => (calls.push(argsOf(issue)), { answer: { fields: { summary: 'Login fails' } } }),
      ask: async (_s, messages) => (asked.push(JSON.stringify(messages)), { answer: answers.shift()! }),
    };
    const reply = await runSteps(action(), values, [issue], { signal }, runner);
    expect(calls).toEqual([{ key: 'INC-1234', limit: 3 }]);
    expect(asked).toHaveLength(2);
    expect(asked[0]).toContain('Login fails');
    expect(asked[1]).toContain('expected one of');
    expect(reply).toEqual({ outputs: [{ label: 'Priority', lines: [], text: 'High' }, { label: 'Where', lines: [], text: 'jira.example.com' }], badge: '✓' });
  });

  it('cuts an answer in text into a list with a match', async () => {
    const reply = await runSteps(action({
      steps: [{ name: 'marks', tool: 'jira.issue', match: '\\[(?<id>\\d+)\\] (?<title>.+)' }],
      outputs: [{ label: 'First', from: 'marks[0].title' }, { label: 'All', from: 'marks', text: '{id}: {title}' }], badge: 'marks',
    }), values, [issue], { signal }, { system: '', runTool: async () => ({ answer: '/:\n[1] Bookmarks bar/\n[2] Other bookmarks/' }) });
    expect(reply).toEqual({
      outputs: [{ label: 'First', lines: [], text: 'Bookmarks bar/' }, { label: 'All', lines: [{ text: '1: Bookmarks bar/' }, { text: '2: Other bookmarks/' }] }],
      badge: '2',
    });
  });

  it('stops at a match that finds nothing', async () => {
    const reply = await runSteps(action(), { input: '', reads: { page: 'https://example.com/' } }, [issue], { signal }, { system: '', runTool: async () => ({ answer: {} }) });
    expect(reply).toEqual({ error: expect.stringContaining('Step 1 (page)') as string });
  });

  it('checks the steps before they are saved', () => {
    expect(actionProblems(action())).toEqual([]);
    expect(actionProblems(action({ steps: [{ name: 'a', prompt: 'x {nope}' }], outputs: [{ label: 'X', from: 'b.c' }], badge: undefined }))).toEqual([
      'Step 1 (a) uses {nope}: no step before it has that name.',
    ]);
    expect(actionProblems(action({ steps: [{ name: 'a', prompt: 'x' }], outputs: [{ label: 'X', from: 'b.c' }], badge: undefined }))).toEqual([
      'Box 1 takes "b.c": it starts with a step\'s name.',
    ]);
  });

  it('writes counts short for the badge', () => {
    expect(['12', '1.234', '1,234', '12 345', 'abc', '1.5'].map(countOf)).toEqual([12, 1234, 1234, 12345, undefined, undefined]);
    expect([7, 999, 1234, 12345, 3_456_789].map(short)).toEqual(['7', '999', '1.2K', '12K', '3.4M']);
  });

  it('lets a model step call its tools before it answers', async () => {
    const asks: unknown[] = [];
    const replies = [
      { answer: '', calls: [{ id: 'c1', name: 'jira__issue', args: { key: 'INC-1' } }] },
      { answer: '{"priority": "Low", "urgent": false}' },
    ];
    const reply = await runSteps(action({ steps: [{ name: 'triage', prompt: 'Triage INC-1', fields: { priority: ['High', 'Low'], urgent: 'boolean' }, tools: ['jira.issue'] }], badge: 'triage.urgent', outputs: [{ label: 'P', from: 'triage.priority' }] }),
      values, [issue], { signal }, {
        system: '',
        runTool: async (name, argsOf) => ({ answer: { name, args: argsOf(issue) }, text: 'Login fails' }),
        ask: async (_s, messages, json, tools) => (asks.push({ n: messages.length, json, tools: tools?.map((t) => t.name) }), replies.shift()!),
      });
    expect(asks).toEqual([{ n: 1, json: false, tools: ['jira__issue'] }, { n: 3, json: false, tools: ['jira__issue'] }]);
    expect(reply).toEqual({ outputs: [{ label: 'P', lines: [], text: 'Low' }], badge: '✗' });
  });

  it('encodes values in a URL, and runs a tool for each item of a list', async () => {
    const seen: unknown[] = [];
    const reply = await runSteps(action({
      steps: [
        { name: 'q', read: '{{url}}', match: 'q=(.*)$' },
        { name: 'pages', tool: 'jira.issue', each: 'q', args: { key: 'https://example.com/s?q={item}&n={q}' } },
      ],
      outputs: [{ label: 'All', from: 'pages' }], badge: 'pages',
    }), { input: '', reads: { q: 'https://example.com/?q=a&b' } }, [issue], { signal }, {
      system: '', runTool: async (_n, argsOf) => (seen.push(argsOf(issue)), { answer: 'ok' }),
    });
    expect(reply).toEqual({ error: expect.stringContaining('"q" is not a list') as string });
    const listed = await runSteps(action({
      steps: [{ name: 'pages', tool: 'jira.issue', each: 'input', args: { key: 'https://example.com/s?q={item.title}' } }],
      outputs: [{ label: 'All', from: 'pages', text: '{value}' }], badge: 'pages',
    }), { input: [{ title: 'a&b' }, { title: 'c #d' }] as unknown as string }, [issue], { signal }, {
      system: '', runTool: async (_n, argsOf) => (seen.push(argsOf(issue)), { answer: 'ok' }),
    });
    expect(seen).toEqual([{ key: 'https://example.com/s?q=a%26b' }, { key: 'https://example.com/s?q=c%20%23d' }]);
    expect(listed).toEqual({ outputs: [{ label: 'All', lines: [{ text: 'ok' }, { text: 'ok' }] }], badge: '2' });
  });
});
