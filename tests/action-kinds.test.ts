// The action editor's guide, apart from the page: the kind an action is, what choosing a kind sets,
// where each of actionProblems' texts goes, a suggested name, and a page load action made steps.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { actionProblems, newAction, type WidgetAction } from '../src/widget/actions';
import { asToolStep, fieldOf, knownFieldOf, lostBy, fromExample, ACTION_EXAMPLES, kindOf, kindPatch, stepOfField, STEPS_OF, suggestActionName } from '../src/ui/widget-actions/kinds';

const base = (change: Partial<WidgetAction>): WidgetAction => ({ ...newAction(), id: 'a', name: 'A', ...change });

describe('the kind of an action', () => {
  it('is what its fields say', () => {
    expect(kindOf(base({ tool: 'wiki.search' }))).toBe('tool');
    expect(kindOf(base({ prompt: 'Explain {input}' }))).toBe('model');
    expect(kindOf(base({ prompt: 'Explain {input}', tool: 'wiki.search' }))).toBe('model');
    expect(kindOf(base({ prompt: 'Explain', openChat: true }))).toBe('chat');
    expect(kindOf(base({ tool: 'wiki.search', when: 'load' }))).toBe('load');
    expect(kindOf(base({ when: 'load', steps: [{ name: 'page', read: '{{url}}' }] }))).toBe('steps');
  });

  it('chosen, sets what makes it that kind, and saves with no problem of kind', () => {
    const d = base({ prompt: 'Explain {input}', input: 'selection', besideSelection: true });
    const load = { ...d, ...kindPatch('load', d, false) };
    expect(load).toMatchObject({ when: 'load', input: 'none', prompt: undefined, besideSelection: undefined });
    const back = { ...load, ...kindPatch('model', load, false) };
    expect(back).toMatchObject({ when: undefined, input: 'selection' });
    const chat = { ...d, tool: 'wiki.search', ...kindPatch('chat', { ...d, tool: 'wiki.search' }, false) };
    expect(chat).toMatchObject({ openChat: true, tool: '', args: {}, prompt: 'Explain {input}' });
    expect(actionProblems(chat)).toEqual([]);
    const steps = { ...d, ...kindPatch('steps', d, false) };
    expect(steps.prompt).toBeUndefined();
    expect(steps.steps?.length).toBe(1);
    expect(kindOf(steps)).toBe('steps');
  });

  it('fresh, starts with what that kind usually has', () => {
    expect(kindPatch('model', newAction(), true)).toMatchObject({ input: 'selection', besideSelection: true, outputs: [{ label: 'Answer' }] });
    expect(kindPatch('chat', newAction(), true)).toMatchObject({ input: 'none', openChat: true });
  });

  it('from an example keeps its id, whether it is on, its sites and agent', () => {
    const d = base({ enabled: false, where: ['https://wiki.example.com/*'], agent: 'helper', tool: 'x' });
    const ex = fromExample(d, ACTION_EXAMPLES[0]!.action);
    expect(ex).toMatchObject({ id: 'a', enabled: false, where: ['https://wiki.example.com/*'], agent: 'helper', tool: '', name: 'Explain' });
    for (const e of ACTION_EXAMPLES) expect(kindOf(fromExample(d, e.action))).toBe(e.kind);
  });
});

describe("actionProblems' texts", () => {
  // Each one, made by an action that has it, and the field it goes beside.
  const cases: [Partial<WidgetAction>, RegExp, string][] = [
    [{ name: '' }, /needs a name/, 'name'],
    [{ tool: 't', where: ['nope'] }, /not a URL pattern/, 'where'],
    [{}, /Choose the tool it runs/, 'tool'],
    [{ openChat: true }, /Write the message/, 'prompt'],
    [{ openChat: true, prompt: 'x', tool: 't' }, /opens the chat runs no tool/, 'tool'],
    [{ openChat: true, prompt: 'x', when: 'load', input: 'none' }, /The chat opens on a click/, 'kind'],
    [{ tool: 't', providerId: 'p' }, /Choose both the provider/, 'model'],
    [{ tool: 't', input: 'none', args: { q: '{input}' } }, /but a parameter uses/, 'args'],
    [{ prompt: 'x {input}', input: 'none' }, /but the prompt uses/, 'prompt'],
    [{ when: 'load', input: 'none' }, /page load runs a tool/, 'tool'],
    [{ when: 'load', input: 'none', tool: 't', prompt: 'x' }, /runs no model/, 'prompt'],
    [{ when: 'load', tool: 't' }, /takes nothing typed/, 'takes'],
    [{ tool: 't', args: { q: '{who}' } }, /The parameter "q" uses/, 'args'],
    [{ tool: 't', reads: { Bad: '{{url}}' } }, /cannot name a value/, 'reads'],
    [{ tool: 't', reads: { who: 'nope' } }, /is read with/, 'reads'],
    [{ prompt: 'x', outputs: [{ label: 'A' }, { label: 'B' }] }, /needs a key/, 'boxes'],
    [{ prompt: 'x', outputs: [{ label: 'A', from: 'k' }, { label: 'B', from: 'k' }] }, /its own key/, 'boxes'],
    [{ tool: 't', outputs: [] }, /Add a box/, 'boxes'],
    [{ tool: 't', outputs: [{ label: '' }] }, /needs a label/, 'boxes'],
    [{ tool: 't', input: 'none', besideSelection: true }, /beside selected text/, 'beside'],
    [{ steps: [{ name: 'page', read: 'nope' }] }, /"read" is/, 'steps'],
    [{ steps: [{ name: 'page', read: '{{url}}' }], outputs: [{ label: 'A', from: 'nope.x' }] }, /starts with a step's name/, 'boxes'],
    [{ steps: [{ name: 'page', read: '{{url}}' }], tool: 't' }, /runs no tool or prompt of its own/, 'steps'],
    [{ steps: [{ name: 'page', read: '{{url}}' }], openChat: true }, /shows its answer in a card/, 'kind'],
  ];
  it.each(cases)('%o: %s goes beside %s', (change, text, field) => {
    const found = actionProblems(base(change)).filter((p) => text.test(p));
    expect(found.length).toBeGreaterThan(0);
    for (const p of found) expect(fieldOf(p)).toBe(field);
  });

  // Every text the checks can push, its values filled in: a new or reworded one with no rule fails here.
  it('each have a field: none goes to what it runs by default', () => {
    const SAMPLE: Record<string, string> = { at: 'Step 1 (page)', where: 'Step 1 (page)', what: 'Box 1', 'i + 1': '1' };
    const fill = (t: string) => {
      let out = '';
      for (let i = 0; i < t.length; i++) {
        if (t[i] !== '$' || t[i + 1] !== '{') { out += t[i]; continue; }
        let depth = 0;
        let j = i + 1;
        for (; j < t.length; j++) if (t[j] === '{') depth++; else if (t[j] === '}' && !--depth) break;
        out += SAMPLE[t.slice(i + 2, j).trim()] ?? 'x';
        i = j;
      }
      return out;
    };
    const texts = ['src/widget/actions.ts', 'src/widget/steps.ts'].flatMap((f) => {
      const src = readFileSync(f, 'utf8');
      return [...src.matchAll(/problems\.push\((?!\.\.\.)\s*(['`])/g)].map((m) => {
        const start = m.index! + m[0].length;
        let end = start;
        let depth = 0;
        for (; end < src.length; end++) {
          const c = src[end];
          if (c === '{' && src[end - 1] === '$') depth++;
          else if (c === '}' && depth) depth--;
          else if (c === m[1] && !depth) break;
        }
        return fill(src.slice(start, end));
      });
    });
    const steps = [`Step 1 (page) uses {x}: no step before it has that name.`, `Box 1 takes "x": it starts with a step's name.`];
    expect(texts.length).toBeGreaterThan(30);
    for (const t of [...texts, ...steps]) expect([t, knownFieldOf(t)]).toEqual([t, expect.any(String)]);
  });

  it('of a field a kind has no step for go to the first step', () => {
    expect(stepOfField(STEPS_OF.load)('takes')).toBe('kind');
    expect(stepOfField(STEPS_OF.model)('beside')).toBe('takes');
  });
});

describe('what a kind or an example would replace', () => {
  it('is named, and nothing when nothing is lost', () => {
    const d = base({ name: '', prompt: 'Explain {input}', providerId: 'p', model: 'm', speak: { when: 'shown' }, outputs: [{ label: 'Answer' }] });
    expect(lostBy(d, { ...d, ...kindPatch('tool', d, false) })).toEqual(['its prompt', 'its model']);
    expect(lostBy(d, { ...d, ...kindPatch('chat', d, false) })).toEqual(['its model']);
    const plain = base({ name: '', input: 'selection', besideSelection: true, outputs: [{ label: 'Answer' }] });
    expect(lostBy(plain, { ...plain, ...kindPatch('chat', plain, false) })).toEqual([]);
    expect(lostBy(plain, { ...plain, ...kindPatch('load', plain, false) })).toEqual(['Show beside selected text']);
  });
});

describe('a suggested name', () => {
  it('comes from its prompt or its tool, and not one another action has', () => {
    expect(suggestActionName(base({ prompt: 'Explain in plain words: {input}' }), [])).toBe('Explain in plain words');
    expect(suggestActionName(base({ tool: 'wiki.search' }), [])).toBe('Wiki search');
    expect(suggestActionName(base({ steps: [{ name: 'r', tool: 'code.open_issues', args: {} }] }), [])).toBe('Code open issues');
    expect(suggestActionName(base({ tool: 'wiki.search' }), ['Wiki search'])).toBeUndefined();
    expect(suggestActionName(base({}), [])).toBeUndefined();
  });
});

describe('a page load action made steps', () => {
  it('runs its tool as a step, its boxes under it, a badge from it, with no problem', () => {
    const d = base({ when: 'load', input: 'none', tool: 'wiki.search', args: { q: '{repo}' }, reads: { repo: '{{url}}' }, outputs: [{ label: 'A', from: 'total' }, { label: 'B', from: '[].title' }, { label: 'C' }] });
    const s = { ...d, ...asToolStep(d) };
    expect(s.outputs.map((o) => o.from)).toEqual(['result.total', 'result[].title', 'result']);
    expect(s).toMatchObject({ tool: '', args: {}, badge: 'result', steps: [{ name: 'result', tool: 'wiki.search', args: { q: '{repo}' } }] });
    expect(actionProblems(s)).toEqual([]);
    expect(kindOf(s)).toBe('steps');
  });
});
