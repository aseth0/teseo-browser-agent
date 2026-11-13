import { describe, expect, it } from 'vitest';
import { runAgentLoop } from '../src/core/agent-loop';
import { stripMarks } from '../src/core/model-texts';
import type { Message, UserRequest } from '../src/core/types';
import { ToolRegistry } from '../src/core/tool-registry';
import { latestPlan, planOf, planShown, questionsOf } from '../src/tools/user/shapes';
import { answersResult, userTools } from '../src/tools/user/user-tools';
import { collect, loop, scripted } from './helpers';

const user: Message[] = [{ role: 'user', parts: [{ type: 'text', text: 'buy a shirt' }] }];

describe('user tools', () => {
  it('check the questions and the plan the model writes', () => {
    expect(questionsOf({ questions: [{ question: 'Size?', options: [{ label: 'S' }, { label: 'M' }] }] })[0]!.type).toBe('choice');
    expect(() => questionsOf({ questions: [{ question: 'Size?', type: 'choice', options: [{ label: 'S' }] }] })).toThrow('2 or more options');
    expect(() => questionsOf({ questions: Array(5).fill({ question: 'x?', type: 'text' }) })).toThrow('at most 4');
    expect(planOf({ steps: [{ title: 'Find it' }] })).toEqual([{ title: 'Find it', status: 'pending' }]);
    expect(() => planOf({ steps: [{ title: 'x', status: 'later' }] })).toThrow('pending, in_progress or done');
  });

  it('pin the plan until it is taken away, or done once the turn that sent it has ended', () => {
    const history: Message[] = [...user, { role: 'assistant', parts: [] }, { role: 'tool', parts: [] }]; // the plan's call in message 1
    const doing = { id: 'c1', at: 1, steps: [{ title: 'Find it', status: 'done' as const }, { title: 'Buy it', status: 'pending' as const }] };
    const done = { id: 'c2', at: 1, steps: doing.steps.map((s) => ({ ...s, status: 'done' as const })) };
    expect(planShown(doing, history, { busy: false })).toBe(true);
    expect(planShown({ ...doing, dismissed: true }, history, { busy: false })).toBe(false);
    expect(planShown(done, history, { busy: true })).toBe(true);
    expect(planShown(done, history, { busy: false })).toBe(false);
    expect(planShown(done, [...history, ...user], { busy: true })).toBe(false); // done in an earlier turn
  });

  it('give the model the answers, one line per question', () => {
    const questions = questionsOf({ questions: [{ question: 'Size?', header: 'Size', type: 'choice', options: [{ label: 'S' }, { label: 'M' }] }, { question: 'Notes?', type: 'text' }] });
    const r = answersResult(questions, [['M'], []]);
    expect(r.type === 'text' && stripMarks(r.text)).toBe('The user answered:\n- Size: M\n- Notes?: (no answer)');
    expect(r.type === 'text' && r.userComment).toBe('Size: M · Notes?: —');
  });

  it('ask through the chat and wait for the answer; the comment shows in the chat', async () => {
    const tools = new ToolRegistry();
    for (const t of userTools()) tools.register(t);
    const asked: UserRequest[] = [];
    const provider = scripted([
      [{ type: 'tool-call', id: 'c1', name: 'user__ask', args: { questions: [{ question: 'Size?', type: 'choice', options: [{ label: 'S' }, { label: 'M' }] }] } }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'tool-call', id: 'c2', name: 'user__plan', args: { steps: [{ title: 'Pick size', status: 'done' }, { title: 'Add to cart', status: 'in_progress' }] } }, { type: 'done', stopReason: 'tool_calls' }],
      [{ type: 'text-delta', text: 'Done' }, { type: 'done', stopReason: 'stop' }],
    ]);
    const interact = async (req: UserRequest) => {
      asked.push(req);
      return { answers: [['M']] };
    };
    const events = await collect(runAgentLoop(user, loop(provider, tools, { tools: { context: { interact } } }), new AbortController().signal));
    expect(asked[0]!.kind).toBe('ask');
    const messages = events.flatMap((e) => (e.type === 'message' ? [e.message] : []));
    const answer = messages[1]!.parts[0]!;
    expect(answer.type === 'tool_result' && [stripMarks(answer.content), answer.userComment]).toEqual(['The user answered:\n- Size?: M', 'Size?: M']);
    expect(latestPlan([...user, ...messages])).toEqual({ id: 'c2', at: 3, steps: [{ title: 'Pick size', status: 'done' }, { title: 'Add to cart', status: 'in_progress' }] }); // with its call, which the ✕ takes away
  });
});
