// Tools to work with the user: ask questions and wait for the answers, have them point at an
// element on the page, show the plan of a long task, and compact the chat's conversation. The
// questions and the picking go through the panel (ToolContext.interact); the plan and the
// compaction are read by the panel from the call itself.
import { markValue, stripMarks, text } from '../../core/model-texts';
import type { AskQuestion, Tool, ToolContext, ToolResult } from '../../core/types';
import { callPage } from '../../page/bridge';
import { fields, optString } from '../define';
import { MAX_QUESTIONS, planOf, questionsOf } from './shapes';

const interact = (ctx: ToolContext) => {
  if (!ctx.interact) throw new Error(text('error.no_chat'));
  return ctx.interact;
};

// The answers as the model gets them (each one marked as the user's), and a short line for the chat.
export function answersResult(questions: AskQuestion[], answers: string[][]): ToolResult {
  const lines = questions.map((q, i) => {
    const answer = answers[i]?.filter(Boolean).join(', ');
    return text('result.user_answer_line', { question: q.header || q.question, answer: answer ? markValue(answer, 'message') : text('result.user_no_answer') });
  });
  const comment = questions.map((q, i) => `${q.header || q.question}: ${answers[i]?.filter(Boolean).join(', ') || '—'}`).join(' · ');
  return { type: 'text', text: text('result.user_answered', { answers: lines.join('\n') }), userComment: comment };
}

export function userTools(): Tool[] {
  return [
    {
      name: 'user.ask',
      description:
        'Asks the user 1 to 4 questions in the chat and waits for the answers. Use it for a decision or information only the user has; ' +
        'do not ask what you can find on the page. Each question has a type: "choice" (one of the options), "multi" (several of them) ' +
        'or "text" (a free answer). Give choice and multi questions 2 to 6 short options; the user can also write another answer.',
      inputSchema: {
        type: 'object',
        properties: {
          questions: {
            type: 'array',
            minItems: 1,
            maxItems: MAX_QUESTIONS,
            items: {
              type: 'object',
              properties: {
                question: { type: 'string', description: 'The question, ending with "?"' },
                header: { type: 'string', description: 'A label of 1 to 3 words, e.g. "Size"' },
                type: { type: 'string', enum: ['choice', 'multi', 'text'] },
                options: {
                  type: 'array',
                  items: { type: 'object', properties: { label: { type: 'string' }, description: { type: 'string' } }, required: ['label'] },
                },
                placeholder: { type: 'string', description: 'For text questions: an example answer' },
              },
              required: ['question', 'type'],
            },
          },
        },
        required: ['questions'],
      },
      source: 'user',
      effect: 'interact',
      run: async (args, ctx) => {
        const questions = questionsOf(args);
        const reply = await interact(ctx)({ kind: 'ask', questions }, ctx.signal);
        return 'dismissed' in reply ? { type: 'text', text: text('result.user_dismissed'), userComment: 'skipped' } : answersResult(questions, reply.answers);
      },
    },
    {
      name: 'user.pick_element',
      description:
        'Asks the user to click an element on the page, and returns it with its ref. Use it when you cannot tell which element the user means.',
      inputSchema: {
        type: 'object',
        properties: { prompt: { type: 'string', description: 'What to click, shown on the page, e.g. "Click the price you want me to track"' } },
      },
      source: 'user',
      effect: 'interact',
      run: async (args, ctx) => {
        if (ctx.tabId === undefined) throw new Error(text('error.no_active_tab'));
        const tabId = ctx.tabId;
        const prompt = optString(fields(args).prompt) ?? '';
        // The card in the panel lets the user cancel; it closes once the page has the answer.
        const done = new AbortController();
        const cancelled = interact(ctx)({ kind: 'pick', prompt }, done.signal).then(() => null);
        const cancel = () => void callPage(tabId, { op: 'pick-cancel' }).catch(() => undefined);
        ctx.signal.addEventListener('abort', cancel);
        try {
          const picked = await Promise.race([callPage(tabId, { op: 'pick', prompt }), cancelled]);
          if (!picked) {
            cancel();
            return { type: 'text', text: text('result.pick_cancelled'), userComment: 'cancelled' };
          }
          return { type: 'text', text: text('result.user_picked', picked), userComment: `picked ${stripMarks(picked.element)}` };
        } finally {
          done.abort();
          ctx.signal.removeEventListener('abort', cancel);
        }
      },
    },
    {
      name: 'user.plan',
      description:
        'Use this at the start of any task with several steps, before acting. Shows the user your plan for a task, with as many steps or phases as you think it needs, and how it goes. Send the whole list every time, each step "pending", ' +
        '"in_progress" or "done", with one step in progress at a time; update it as you go.',
      inputSchema: {
        type: 'object',
        properties: {
          steps: {
            type: 'array',
            items: {
              type: 'object',
              properties: { title: { type: 'string' }, status: { type: 'string', enum: ['pending', 'in_progress', 'done'] } },
              required: ['title', 'status'],
            },
          },
        },
        required: ['steps'],
      },
      source: 'user',
      effect: 'interact',
      run: async (args) => {
        const steps = planOf(args);
        return { type: 'text', text: text('result.plan_shown', { done: String(steps.filter((s) => s.status === 'done').length), total: String(steps.length) }) };
      },
    },
    {
      name: 'chat.compact',
      description:
        'Compacts this conversation when the current turn ends: from the next message on, the earlier turns go to you trimmed and summarized, ' +
        'while the chat and the saved conversation keep them whole. Use it when the user asks, or on your own when the conversation has grown long ' +
        'and its earlier turns are no longer needed in full (for example, before starting an unrelated task). Call it once, then finish the turn.',
      inputSchema: {
        type: 'object',
        properties: {
          instructions: {
            type: 'string',
            description: 'What the summary must keep or focus on, e.g. "the prices found and what is still pending". When the user wrote instructions, pass them exactly as written.',
          },
        },
      },
      source: 'user',
      effect: 'read', // nothing is lost: only what goes to the model changes
      // The side panel compacts once the turn ends (sidepanel/useCompaction), with the call's instructions (compactCall).
      run: async (_args, ctx) => {
        interact(ctx);
        return { type: 'text', text: text('result.compact_scheduled') };
      },
    },
  ];
}
