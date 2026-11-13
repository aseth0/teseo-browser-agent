import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { register, render } from 'pele/core';
import sequence from 'pele/diagrams/sequence';
import { describe, expect, it } from 'vitest';
import type { Message } from '../src/core/types';
import { ChatHistory, toolResultsById } from '../src/ui/ChatMessages';
import { groupOf } from '../src/ui/chat/diagrams/mindmap';
import { diagramKindOf, turnDiagramOf, type TurnInput } from '../src/ui/chat/turn-diagram';
import { labelOf } from '../src/ui/chat/turn-steps';

const seq = (input: Omit<TurnInput, 'messages'>) => turnDiagramOf('sequence', { messages: [], ...input });

register(sequence);
for (const kind of ['flowchart', 'mindmap', 'gantt', 'pie']) register((await import(`pele/diagrams/${kind}`)).default);

const user = (text: string): Message => ({ role: 'user', parts: [{ type: 'text', text }] });
const say = (text: string): Message => ({ role: 'assistant', parts: [{ type: 'text', text }] });
const think = (text: string, calls: { id: string; name: string }[] = []): Message => ({
  role: 'assistant',
  parts: [{ type: 'reasoning', text }, ...calls.map((c) => ({ type: 'tool_call' as const, id: c.id, name: c.name, args: {} }))],
});
const result = (toolCallId: string, content: string, extra: object = {}): Message => ({ role: 'tool', parts: [{ type: 'tool_result', toolCallId, content, ...extra }] });

describe('labelOf', () => {
  it('keeps a label on one line, cut, with Mermaid syntax as entity codes', () => {
    expect(labelOf('a\n  b')).toBe('a b');
    expect(labelOf('x'.repeat(40), 10)).toBe(`${'x'.repeat(9)}…`);
    expect(labelOf('abcdefghij', 5, { tail: true })).toBe('…ghij');
    expect(labelOf('#1; 50% <b>{x}</b>')).toBe('#35;1#59; 50#37; #60;b#62;#123;x#125;#60;/b#62;');
  });
});

describe('diagram kinds and tool groups', () => {
  it('draws a kind saved by a newer build as a sequence', () => {
    expect(diagramKindOf('flowchart')).toBe('flowchart');
    expect(diagramKindOf('timeline3d')).toBe('sequence');
    expect(diagramKindOf(undefined)).toBe('sequence');
  });

  it('groups a tool by the first separator, keeping the rest of its name', () => {
    expect(groupOf('mcp__docs__search')).toEqual(['mcp', 'docs__search']);
    expect(groupOf('browser.find')).toEqual(['browser', 'find']);
    expect(groupOf('remember')).toEqual(['other', 'remember']);
  });
});

describe('turnDiagramOf', () => {
  const history = [
    user('Find the open PRs'),
    think('I should open the list', [{ id: 'c1', name: 'browser.open' }, { id: 'c2', name: 'shell.run' }]),
    result('c1', 'ok'),
    result('c2', 'not allowed', { isError: true }),
    think('Ask a reviewer', [{ id: 'c3', name: 'agents.ask' }]),
    result('c3', 'Not reversible', {
      trace: { agent: 'Reviewer', messages: [think('read it', [{ id: 's1', name: 'browser.read_page' }]), result('s1', 'page')] },
    }),
  ];
  const results = toolResultsById(history);

  it('draws you, the agent, its tools and the agents it asked, in order', () => {
    const { source = '', counts } = seq({ user: history[0], steps: history.slice(1), results, answered: true });
    expect(counts).toEqual({ thoughts: 2, tools: 3, errors: 1, agents: 1 });
    expect(source.split('\n')).toEqual([
      'sequenceDiagram',
      'actor You',
      'participant A as Agent',
      'participant T as Tools',
      'participant S1 as Reviewer',
      'You->>A: Find the open PRs',
      'Note over A: 💭 I should open the list',
      'A->>T: browser.open',
      'T-->>A: ✓',
      'A->>T: shell.run',
      'T--xA: ✗ not allowed',
      'Note over A: 💭 Ask a reviewer',
      'A->>S1: agents.ask',
      'activate S1',
      'Note over S1: 💭 read it',
      'S1->>T: browser.read_page',
      'T-->>S1: ✓',
      'S1-->>A: Not reversible',
      'deactivate S1',
      'A-->>You: Answer ↓',
    ]);
    expect(render(source).svg).toContain('<svg');
  });

  it('shows a running call and the reasoning streaming now, by its end', () => {
    const steps = [think('look', [{ id: 'c9', name: 'browser.find' }])];
    const { source = '' } = seq({ user: user('go'), steps, results: new Map(), answered: false, running: true, live: [{ kind: 'reasoning', text: `start ${'^*'.repeat(40)}` }] });
    expect(source).toContain('T-->>A: ⏳ running…');
    expect(source.split('\n').at(-1)).toMatch(/^Note over A: 💭 …[\^*]{31}$/);
    expect(seq({ user: user('go'), steps, results: new Map(), answered: false }).source).toContain('T--xA: not run');
  });

  it('leaves the reasoning out when it is hidden', () => {
    const { source, counts } = seq({ steps: history.slice(1, 2), results, answered: false, reasoning: false });
    expect(source).not.toContain('Note over');
    expect(counts.thoughts).toBe(0);
  });

  it('never lets a label add markup to the svg', () => {
    const { source = '' } = seq({ user: user('<img src=x onerror=alert(1)> "q" <script>x</script>'), steps: [], results: new Map(), answered: true });
    const { svg } = render(source);
    expect(svg).not.toMatch(/<img|<script/);
    expect(svg).toContain('&lt;img src=x onerror=alert(1)&gt;'); // as text
  });
});

describe('the other kinds', () => {
  const timed = (m: Message, sinceStartMs: number, ms: number): Message => ({ ...m, meta: { input: 1000, output: 50, reported: true, ms, sinceStartMs } });
  const history = [
    user('Find "the" PRs: #1'),
    timed(think('open it', [{ id: 'c1', name: 'browser__find' }, { id: 'c2', name: 'browser__find' }]), 1500, 1200),
    result('c1', 'ok'),
    result('c2', 'bad', { isError: true }),
    timed(think('ask', [{ id: 'c3', name: 'agents__ask' }]), 3000, 1000),
    result('c3', 'Done', { trace: { agent: 'Reviewer', messages: [think('read', [{ id: 's1', name: 'browser__read_page' }]), result('s1', 'page')] } }),
    timed(say('The answer'), 4200, 900),
  ];
  const input: TurnInput = { user: history[0], messages: history.slice(1), steps: history.slice(1, -1), results: toolResultsById(history), answered: true };
  const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)</g)].map((m) => m[1]).join(' | ');

  it('draws a flowchart: steps as nodes, results on the arrows, the agent asked as a group', () => {
    const { source = '' } = turnDiagramOf('flowchart', input);
    expect(source).toMatch(/^flowchart TD\n/);
    expect(source).toContain('subgraph');
    const drawn = texts(render(source).svg);
    for (const t of ['You: Find &quot;the&quot; PRs: #1', '💭 open it', 'browser__find', '✗ bad', 'Reviewer', 'browser__read_page', 'Answer ↓']) expect(drawn).toContain(t);
  });

  it('draws an arrow whose result has brackets and bars', () => {
    const odd = [user('go'), think('try', [{ id: 'c1', name: 'browser__find' }]), result('c1', 'bad (x) [4] a|b', { isError: true })];
    const { source = '' } = turnDiagramOf('flowchart', { user: odd[0], messages: odd.slice(1), steps: odd.slice(1), results: toolResultsById(odd), answered: true });
    expect(texts(render(source).svg)).toContain('✗ bad (x) [4] a|b');
  });

  it('draws a mind map: tools by group, with how many times', () => {
    const drawn = texts(render(turnDiagramOf('mindmap', input).source!).svg);
    for (const t of ['💭 Thoughts', '🔧 Tools', 'browser', 'find ×2 ✓ ✗', '🤖 Agents', 'Reviewer ✓', '✓ Answer']) expect(drawn).toContain(t);
  });

  it('draws the model calls on the turn clock, with what ran between them', () => {
    const { source = '' } = turnDiagramOf('gantt', input);
    expect(source.split('\n')).toEqual([
      'gantt', 'dateFormat x', 'axisFormat %S.%L s', 'section Model',
      'Model 1 · 2 tools · 1.2 s :m0, 300, 1500',
      'Model 2 · 1 tool · 1.0 s :m1, 2000, 3000',
      'Model 3 · text · 0.9 s :m2, 3300, 4200',
      'section Tools and page',
      'Reading the page :b0, 0, 300',
      'browser__find, browser__find :b1, 1500, 2000',
      'agents__ask :b2, 3000, 3300',
    ]);
    expect(texts(render(source).svg)).toContain('Model 3 · text · 0.9 s');
  });

  it('draws the tokens by model call', () => {
    const { source = '' } = turnDiagramOf('pie', input);
    expect(source).toContain('"Call 2 → agents__ask" : 1050');
    expect(texts(render(source).svg)).toContain('Call 3 → text');
  });

  it('says why when the turn has no timing', () => {
    const plain = { ...input, messages: input.messages.map(({ meta: _meta, ...m }) => m) };
    expect(turnDiagramOf('gantt', plain).source).toBeUndefined();
    expect(turnDiagramOf('gantt', plain).none).toMatch(/timing/);
    expect(turnDiagramOf('pie', plain).none).toMatch(/token counts/);
  });
});

describe('ChatHistory with turn diagrams', () => {
  const history = [user('one'), think('a', [{ id: 'c1', name: 'browser.open' }]), result('c1', 'ok'), say('First answer'), user('two'), think('b'), say('Second answer')];
  const html = renderToStaticMarkup(
    createElement(ChatHistory, { history, results: toolResultsById(history), running: false, format: 'plain', diagrams: true }),
  );

  it('draws each turn above its answer, the latest open and the steps folded under it', () => {
    const diagrams = html.match(/<details class="turn-diagram"[^>]*>/g) ?? [];
    expect(diagrams).toHaveLength(2);
    expect(diagrams[0]).not.toContain('open');
    expect(diagrams[1]).toContain('open');
    // Each svg goes in once mounted, through diagramSvg's allowlist (tests/mermaid-block), with its zoom.
    expect(html.match(/class="turn-diagram-svg diagram-svg" role="img"/g)).toHaveLength(2);
    expect(html.match(/class="zoom-controls"/g)).toHaveLength(2);
    expect(html).toContain('<details class="turn-diagram-steps"><summary>Steps</summary>');
    // The answers stay outside the diagrams, after them.
    expect(html.indexOf('First answer')).toBeGreaterThan(html.indexOf('turn-diagram-steps'));
    expect(html.lastIndexOf('</details>', html.indexOf('First answer'))).toBeLessThan(html.indexOf('First answer'));
  });

  it('draws nothing when off', () => {
    const off = renderToStaticMarkup(createElement(ChatHistory, { history, results: toolResultsById(history), running: false, format: 'plain' }));
    expect(off).not.toContain('turn-diagram');
  });
});
