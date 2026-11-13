import { describe, expect, it } from 'vitest';
import { confirmAnswer, userReply } from '../src/background/session';
import { createQuestions } from '../src/core/questions';

type Q = { type: 'confirm' | 'access'; id: string };
const confirm = (id: string): Q => ({ type: 'confirm', id });

describe('createQuestions', () => {
  it('passes the answer back and forgets the question', async () => {
    const sent: Q[] = [];
    const q = createQuestions<Q>((m) => sent.push(m));
    const reply = q.ask(confirm, 'no');
    q.answer(sent[0]!.id, 'confirm', 'yes');
    expect(await reply).toBe('yes');
    expect(q.isWaiting(sent[0]!.id)).toBe(false);
  });

  it('answers with the fallback, without asking, a question from a run already stopped', async () => {
    const sent: Q[] = [];
    const q = createQuestions<Q>((m) => sent.push(m));
    const stopped = new AbortController();
    stopped.abort();
    expect(await q.ask(confirm, 'no', stopped.signal)).toBe('no');
    expect(sent).toEqual([]);
  });

  it('answers with the fallback when its run stops while waiting', async () => {
    const sent: Q[] = [];
    const q = createQuestions<Q>((m) => sent.push(m));
    const run = new AbortController();
    const reply = q.ask(confirm, 'no', run.signal);
    run.abort();
    expect(await reply).toBe('no');
    expect(q.isWaiting(sent[0]!.id)).toBe(false);
  });

  it('denies every waiting question at once', async () => {
    const q = createQuestions<Q>(() => {});
    const replies = [q.ask(confirm, 'a'), q.ask(confirm, 'b')];
    q.denyAll();
    expect(await Promise.all(replies)).toEqual(['a', 'b']);
  });

  it('takes a reply only for a question of its own kind', async () => {
    const sent: Q[] = [];
    const q = createQuestions<Q>((m) => sent.push(m));
    const reply = q.ask(confirm, 'no');
    q.answer(sent[0]!.id, 'access', true); // a permission's reply cannot allow an action
    expect(q.isWaiting(sent[0]!.id)).toBe(true);
    q.answer(sent[0]!.id, 'confirm', 'yes');
    expect(await reply).toBe('yes');
  });
});

describe("the panel's replies", () => {
  it('deny unless they carry a known decision, and keep only a text comment', () => {
    expect(confirmAnswer({ decision: 'always', comment: 'ok' })).toEqual({ decision: 'always', comment: 'ok' });
    expect(confirmAnswer({ decision: 'yes', comment: { x: 1 } })).toEqual({ decision: 'deny' });
    expect(confirmAnswer({ decision: undefined })).toEqual({ decision: 'deny' });
    expect(confirmAnswer({ decision: 'allow', edits: { description: 'New', n: 2 } })).toEqual({ decision: 'allow', edits: { description: 'New' } });
    expect(confirmAnswer({ decision: 'allow', edits: ['x'] })).toEqual({ decision: 'allow' });
  });

  it("are a user's answers only when they are lists of texts", () => {
    expect(userReply({ answers: [['a'], ['b', 'c']] })).toEqual({ answers: [['a'], ['b', 'c']] });
    expect(userReply({ answers: [[1]] })).toEqual({ dismissed: true });
    expect(userReply({ dismissed: true })).toEqual({ dismissed: true });
    expect(userReply(null)).toEqual({ dismissed: true });
  });
});
