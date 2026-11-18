// A brief (agents/brief): the task, then the sections a call fills, then how to shape the answer.
import { describe, expect, it } from 'vitest';
import { briefDetails, briefOf, briefShown, briefText, inBriefOrder } from '../src/agents/brief';
import { setTextOverrides } from '../src/core/model-texts';

const ANSWER = '\n\nEnd your answer with two short lines:\nDid: what you did.\nNot done or not verified: what you could not do or check, or "nothing".';

describe('a brief', () => {
  it('with the task alone: the task, then how to answer', () => {
    const b = briefOf({ task: ' find it ' })!;
    expect(b).toEqual({ task: 'find it' });
    expect(briefShown(b)).toBe('find it');
    expect(briefText(b)).toBe(`find it${ANSWER}`);
  });
  it('with every field: each in its section, in a fixed order', () => {
    const b = briefOf({ report: 'R', done: 'D', constraints: 'C', context: 'K', task: 'T' })!;
    expect(briefText(b)).toBe(`T\n\n## Already known\nK\n\n## Do not\nC\n\n## Done when\nD\n\n## Send back\nR${ANSWER}`);
    expect(briefDetails(b).map((d) => d.label)).toEqual(['Already known', 'Do not', 'Done when', 'Send back']);
  });
  it('leaves out a field empty, blank or not a string', () => {
    const b = briefOf({ task: 'T', context: '', constraints: '  \n ', done: 3, report: { a: 1 } })!;
    expect(b).toEqual({ task: 'T' });
    expect(briefText(b)).toBe(`T${ANSWER}`);
  });
  it('is none without a task', () => {
    expect(briefOf({ task: ' ', context: 'K' })).toBeUndefined();
    expect(briefOf(undefined)).toBeUndefined();
  });
  it('uses the texts the user edited', () => {
    setTextOverrides({ 'brief.context': '\nKnown: {context}', 'brief.answer': '\nSay what you checked.' });
    try {
      expect(briefText(briefOf({ task: 'T', context: 'K' })!)).toBe('T\nKnown: K\nSay what you checked.');
    } finally {
      setTextOverrides(undefined);
    }
  });
  it("puts a call's arguments in the schema's order, others after", () => {
    expect(Object.keys(inBriefOrder({ x: 1, report: 'R', task: 'T', agent: 'a' }) as object)).toEqual(['agent', 'task', 'report', 'x']);
    expect(inBriefOrder('raw')).toBe('raw');
  });
});
