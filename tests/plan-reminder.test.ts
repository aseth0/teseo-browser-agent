import { afterEach, describe, expect, it } from 'vitest';
import { PLAN_START_REMINDER_ROUNDS, planReminder, planStartReminder, stepPlanReminder } from '../src/context/plan-reminder';
import { LIMIT_DEFS, setLimitOverrides } from '../src/core/limits';
import { stripMarks, text } from '../src/core/model-texts';
import { toOpenAIMessages } from '../src/providers/wire';
import type { Message } from '../src/core/types';
import { latestPlan, planShown, withPlansDismissed } from '../src/tools/user/shapes';
import { userTools } from '../src/tools/user/user-tools';
import { stepAttached } from '../src/ui/chat/turns';

const user: Message = { role: 'user', parts: [{ type: 'text', text: 'buy a shirt' }] };
const call = (id: string, name: string, args: unknown = {}, isError = false): Message[] => [
  { role: 'assistant', parts: [{ type: 'tool_call', id, name, args }] },
  { role: 'tool', parts: [{ type: 'tool_result', toolCallId: id, content: 'ok', ...(isError && { isError }) }] },
];
const plan = (id: string, status: 'pending' | 'done' = 'pending', isError = false) =>
  call(id, 'user__plan', { steps: [{ title: 'Find it', status: 'done' }, { title: 'Buy it', status }] }, isError);
const rounds = (n: number) => Array.from({ length: n }, (_, i) => call(`f${i}`, 'browser__find')).flat();
// One step of the model that makes `n` calls at once.
const parallel = (n: number, tag = 'g'): Message[] => [
  { role: 'assistant', parts: Array.from({ length: n }, (_, i) => ({ type: 'tool_call' as const, id: `${tag}${i}`, name: 'browser__find', args: {} })) },
  { role: 'tool', parts: Array.from({ length: n }, (_, i) => ({ type: 'tool_result' as const, toolCallId: `${tag}${i}`, content: 'ok' })) },
];
const EVERY = LIMIT_DEFS.planReminder.value;

describe('plan reminder', () => {
  it('reminds the model of a plan with steps to do every so many tool calls without it', () => {
    const history = [user, ...plan('p1')];
    expect(planReminder([...history, ...rounds(EVERY - 1)])).toBeUndefined();
    const item = planReminder([...history, ...rounds(EVERY)]);
    expect(item && stripMarks(item.text)).toContain(`You have made ${EVERY} tool calls in this turn`);
    expect(item && stripMarks(item.text)).toContain('- [done] Find it\n- [pending] Buy it');
    expect(planReminder([...history, ...rounds(EVERY + 1)])).toBeUndefined(); // not every call after
    expect(planReminder([...history, ...rounds(EVERY * 2)])).toBeDefined();
  });

  it('counts each call of a step that makes several at once', () => {
    const history = [user, ...plan('p1')];
    expect(planReminder([...history, ...parallel(EVERY - 1)])).toBeUndefined();
    expect(planReminder([...history, ...parallel(EVERY + 2)])).toBeDefined();
    expect(planReminder([...history, ...parallel(EVERY - 1), ...parallel(2, 'h')])).toBeDefined(); // goes past it
  });

  it('counts from the last plan shown, and says nothing of one done or one that failed', () => {
    expect(planReminder([user, ...plan('p1'), ...rounds(EVERY - 1), ...plan('p2')])).toBeUndefined();
    expect(planReminder([user, ...plan('p1'), ...rounds(EVERY - 1), ...plan('p2'), ...parallel(1)])).toBeUndefined();
    expect(planReminder([user, ...plan('p1', 'done'), ...rounds(EVERY)])).toBeUndefined();
    expect(planReminder([user, ...plan('p1', 'pending', true), ...rounds(EVERY)])).toBeUndefined();
    expect(planReminder([user, ...rounds(EVERY)])).toBeUndefined();
  });

  it('says nothing of a plan from an earlier turn', () => {
    expect(planReminder([user, ...plan('p1'), user, ...rounds(EVERY)])).toBeUndefined();
  });

  describe('with the limits changed', () => {
    afterEach(() => setLimitOverrides(undefined));

    it('comes every as many calls as set', () => {
      setLimitOverrides({ planReminder: 3, planReminderAlways: 0 });
      expect(planReminder([user, ...plan('p1'), ...rounds(3)])).toBeDefined();
      expect(planReminder([user, ...plan('p1'), ...rounds(2)])).toBeUndefined();
    });

    it('comes every so many calls of the turn even when the model keeps updating its plan, unless off', () => {
      setLimitOverrides({ planReminder: 50, planReminderAlways: 6 });
      const updating = [user, ...plan('p1'), ...parallel(4, 'a'), ...plan('p2'), ...parallel(4, 'b')];
      const item = planReminder(updating);
      expect(item && stripMarks(item.text)).toContain('You have made 8 tool calls in this turn');
      setLimitOverrides({ planReminder: 50, planReminderAlways: 0 });
      expect(planReminder(updating)).toBeUndefined();
    });
  });

  it('shows in the chat as what went after the result', () => {
    const item = planReminder([user, ...plan('p1'), ...rounds(EVERY)])!;
    const result = { type: 'tool_result' as const, toolCallId: 'f4', content: 'ok', attached: [{ kind: item.kind, text: item.text, source: item.source }] };
    expect(stepAttached(result).plan).toEqual([item.text]);
  });
});

describe('plan start reminder', () => {
  it('asks once in the turn for a plan after so many rounds without one', () => {
    expect(planStartReminder([user, ...rounds(PLAN_START_REMINDER_ROUNDS - 1)])).toBeUndefined();
    const item = planStartReminder([user, ...rounds(PLAN_START_REMINDER_ROUNDS)]);
    expect(item && stripMarks(item.text)).toContain(`made ${PLAN_START_REMINDER_ROUNDS} rounds of tool calls in this turn without showing a plan`);
    expect(planStartReminder([user, ...rounds(PLAN_START_REMINDER_ROUNDS + 1)])).toBeUndefined();
  });

  it('says nothing once a plan was shown in this turn, done or not', () => {
    expect(planStartReminder([user, ...plan('p1'), ...rounds(PLAN_START_REMINDER_ROUNDS)])).toBeUndefined();
    expect(planStartReminder([user, ...plan('p1', 'done'), ...rounds(PLAN_START_REMINDER_ROUNDS)])).toBeUndefined();
  });

  it('asks again in a new turn, and when the only plan of this one failed', () => {
    expect(planStartReminder([user, ...plan('p1'), user, ...rounds(PLAN_START_REMINDER_ROUNDS)])).toBeDefined();
    expect(planStartReminder([user, ...plan('p1', 'pending', true), ...rounds(PLAN_START_REMINDER_ROUNDS - 1)])).toBeDefined();
  });

  it('shows in the chat as a plan reminder', () => {
    const item = planStartReminder([user, ...rounds(PLAN_START_REMINDER_ROUNDS)])!;
    const result = { type: 'tool_result' as const, toolCallId: 'f2', content: 'ok', attached: [{ kind: item.kind, text: item.text, source: item.source }] };
    expect(stepAttached(result).plan).toEqual([item.text]);
  });
});

describe('the reminder of a step', () => {
  it('asks for a plan only while user.plan is offered', () => {
    const history = [user, ...rounds(PLAN_START_REMINDER_ROUNDS)];
    expect(stepPlanReminder(history, true)).toBeDefined();
    expect(stepPlanReminder(history, false)).toBeUndefined();
  });

  it('keeps reminding of the plan shown', () => {
    const history = [user, ...plan('p1'), ...rounds(EVERY)];
    expect(stepPlanReminder(history, true)?.text).toBe(planReminder(history)?.text);
  });
});

describe('what asks for a plan', () => {
  it('says when to start one in the system prompt', () => {
    expect(stripMarks(text('system.plan'))).toContain('call user__plan before any other tool');
  });

  it('says when to use it in the tool description', () => {
    const tool = userTools().find((t) => t.name === 'user.plan')!;
    expect(tool.description.startsWith('Use this at the start of any task with several steps, before acting.')).toBe(true);
  });
});

describe('a plan the user took away', () => {
  const closed = (history: Message[], id = 'p1') => withPlansDismissed(history, new Set([id]));

  it('is marked on its call alone, leaving the history as it was', () => {
    const history = [user, ...plan('p1'), ...plan('p2')];
    const out = closed(history);
    expect(latestPlan(out)).toMatchObject({ id: 'p2' });
    expect(latestPlan(out)?.dismissed).toBeUndefined();
    expect(latestPlan(closed(history, 'p2'))).toMatchObject({ id: 'p2', dismissed: true });
    expect(latestPlan(history)?.dismissed).toBeUndefined();
    expect(withPlansDismissed(history, new Set())).toBe(history);
    expect(withPlansDismissed(history, new Set(['other']))).toEqual(history);
  });

  it('is not pinned, and a new plan is', () => {
    const history = closed([user, ...plan('p1')]);
    expect(planShown(latestPlan(history)!, history, { busy: false })).toBe(false);
    const again = [...history, ...plan('p2')];
    expect(planShown(latestPlan(again)!, again, { busy: false })).toBe(true);
  });

  it('is not reminded of, nor asked for again in that turn', () => {
    const history = closed([user, ...plan('p1')]);
    expect(planReminder([...history, ...rounds(EVERY)])).toBeUndefined();
    expect(planStartReminder([...history, ...rounds(PLAN_START_REMINDER_ROUNDS)])).toBeUndefined();
  });

  it('never goes to the model as a mark', () => {
    const [, call] = closed([user, ...plan('p1')]);
    expect(toOpenAIMessages(undefined, [call!])[0]!.tool_calls![0]).not.toHaveProperty('dismissed');
    expect(JSON.stringify(toOpenAIMessages(undefined, [call!]))).not.toContain('dismissed');
  });
});
