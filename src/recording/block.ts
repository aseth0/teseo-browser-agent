// A reviewed recording as the model gets it: the calls ticked, in order, with the values the user hid
// hidden, in an untrusted block (core/texts 'recording.block'). Past the limit (Settings → Limits),
// the calls that do not fit go without their bodies.
import { cutDetail, limit } from '../core/limits';
import { cutNote, markPageData, stripMarks } from '../core/origin-marks';
import { text } from '../core/texts/registry';
import { prettyBody, recordedCalls, shownUrl, withHidden, type Recording, type RecordedCall } from './recording';
import type { RecordedStep } from './step-types';
import { answerText, placeText, variablesOf, type Variable } from './variables';

const head = (c: RecordedCall, n: number, site: string, hidden: string[], names?: Record<string, string>) =>
  `#${n} ${c.method} ${withHidden(shownUrl(c.url, site), hidden, names)} → ${c.status ?? (c.error ? `failed: ${c.error}` : 'no answer')}`;

const bodies = (c: RecordedCall, hidden: string[], names?: Record<string, string>) =>
  [
    c.requestBody && `sent:\n${withHidden(prettyBody(c.requestBody), hidden, names)}`,
    c.responseBody !== undefined ? `answer${c.responseType ? ` (${c.responseType})` : ''}:\n${withHidden(prettyBody(c.responseBody), hidden, names)}` : 'answer: not seen',
  ].filter(Boolean).join('\n');

// "- versionNumber = 8: the answer of #1 (version.number) + 1; in #3 sent (version.number)"
function variableLine(v: Variable, hidden: string[], names?: Record<string, string>): string {
  const value = /^\d+$/.test(v.value) ? v.value : JSON.stringify(v.value);
  const source =
    v.kind === 'answer' && v.from ? `from the answer of ${answerText(v.from)}`
    : v.kind === 'computed' && v.from ? `the answer of ${answerText(v.from)} + 1`
    : 'a parameter';
  return withHidden(`- ${v.name} = ${value}: ${source}; in ${v.uses.map(placeText).join(', ')}`, hidden, names);
}

// The variables the user kept (the fixed ones go as recorded), after a line saying what to do; their
// values come from the page. Only for Make a tool… (`r.tool`): attached alone, the recording has none.
// A value hidden under a name (••••[name]) needs the line too: it says how a tool sends it ({{secret:name}}).
function variablesText(r: Recording): string {
  const kept = r.tool ? variablesOf(r).filter((v) => v.kind !== 'fixed') : [];
  const named = r.hidden.some((v) => r.hiddenNames?.[v]);
  if (!kept.length && !named) return '';
  return `\n\n${text('recording.variables')}${kept.length ? `\n${markPageData(kept.map((v) => variableLine(v, r.hidden, r.hiddenNames)).join('\n'))}` : ''}`;
}

const STEP_TEXT = 200; // characters of what was typed, at most

// A step of a tabs-and-mouse recording, in its place among the calls.
function stepLine(s: RecordedStep, hidden: string[], names?: Record<string, string>): string {
  const line =
    s.kind === 'click' ? `🖱 clicked ${s.target ?? 'the page'}`
    : s.kind === 'tab' ? `→ tab ${s.target ?? ''}`
    : s.text === undefined ? `⌨ typed into ${s.target ?? 'a field'} (text not kept)`
    : `⌨ typed ${JSON.stringify(s.text.length > STEP_TEXT ? `${s.text.slice(0, STEP_TEXT)}…` : s.text)} into ${s.target ?? 'a field'}`;
  return withHidden(line, hidden, names);
}

export const recordingBlock = (r: Recording): string => built(r).text;

// What the review shows of it: the text as sent, its size against the limit, and how many calls go
// without their bodies.
export function recordingPreview(r: Recording): { text: string; size: number; max: number; cut: number } {
  const { text: block, cut } = built(r);
  const shown = stripMarks(block);
  return { text: shown, size: shown.length, max: limit('recording'), cut };
}

function built(r: Recording): { text: string; cut: number } {
  const calls = recordedCalls(r);
  const max = limit('recording');
  const out: string[] = [];
  let used = 0;
  let cut = 0;
  const steps = [...(r.steps ?? [])].sort((x, y) => x.at - y.at);
  let next = 0;
  let stepsLeft = 0; // past the limit: counted, not shown
  const stepsUntil = (at: number) => {
    while (next < steps.length && steps[next]!.at <= at) {
      const line = stepLine(steps[next++]!, r.hidden, r.hiddenNames);
      if (used + line.length <= max) {
        out.push(line);
        used += line.length;
      } else stepsLeft++;
    }
  };
  calls.forEach((c, i) => {
    stepsUntil(c.at);
    const line = head(c, i + 1, r.site, r.hidden, r.hiddenNames);
    const whole = `${line}\n${bodies(c, r.hidden, r.hiddenNames)}`;
    if (!cut && used + whole.length <= max) {
      out.push(whole);
      used += whole.length;
    } else {
      out.push(`${line}\n(bodies left out: over the limit)`);
      cut++;
    }
  });
  stepsUntil(Infinity);
  const stepsNote = stepsLeft ? `\n${stepsLeft} ${stepsLeft === 1 ? 'step' : 'steps'} left out: over the limit.` : '';
  const note = cut ? `\n${cutNote(cutDetail('recording', undefined, max))}${cut} ${cut === 1 ? 'call' : 'calls'} without their bodies.` : '';
  return { text: text('recording.block', { site: r.site, count: String(calls.length), calls: markPageData(out.join('\n\n')) + note + stepsNote + variablesText(r) }), cut };
}
