// During a turn (Settings → Compaction): the model's later requests of one turn leave out what it read
// earlier in it. The latest few tool results go whole; an earlier one longer than a few lines goes as a
// note, as do every screenshot but the latest and every list of page elements after an action but the
// latest (the model can call the tool again). Not the result of a call that cannot be made again
// without doing something again (a write, asking an agent or the user): that one goes whole. Only what
// is sent: the history and the chat keep them. Compaction (context/compaction) is applied after it.
import { text } from '../core/model-texts';
import { toWireName, type ToolRegistry } from '../core/tool-registry';
import type { Message, Part, Tool } from '../core/types';
import type { InRunSettings } from '../storage/settings-types';
import { ALL_PARTS, callNames, KEEP_CHARS, resultWhat, splitAttached, trimMessages } from './compaction';

export const IN_RUN_DEFAULTS = { enabled: true, keepResults: 2, minChars: KEEP_CHARS, lastScreenshot: true, lastElements: true } as const;
export const IN_RUN_RANGES = { keepResults: [1, 15], minChars: [100, 20000] } as const;
type InRun = { enabled: boolean; keepResults: number; minChars: number; lastScreenshot: boolean; lastElements: boolean };

const within = (v: number | undefined, [min, max]: readonly [number, number], fallback: number) =>
  v === undefined || !Number.isFinite(v) ? fallback : Math.min(max, Math.max(min, Math.round(v)));

export const inRunOf = (s: InRunSettings | undefined): InRun => ({
  ...IN_RUN_DEFAULTS,
  ...s,
  keepResults: within(s?.keepResults, IN_RUN_RANGES.keepResults, IN_RUN_DEFAULTS.keepResults),
  minChars: within(s?.minChars, IN_RUN_RANGES.minChars, IN_RUN_DEFAULTS.minChars),
});

const note = (what: string, chars: number, kept = false) => text(kept ? 'run.left_out_kept' : 'run.left_out', { what, chars: chars.toLocaleString('en-US') });

type ToolResultPart = Extract<Part, { type: 'tool_result' }>;
// The tools that read a skill, by their wire names.
const SKILL_READS = ['skills.load', 'skills.read_reference'].map(toWireName);

// Whether a call of the tool (by its name as the call has it: the wire name the model sent) may be
// made again for its result: it only reads (or says it may, Tool.repeatable), and is not an agent's
// or the user's answer. One no longer offered: as one that reads.
export type Repeatable = (name: string) => boolean;
type RepeatInfo = Pick<Tool, 'effect' | 'source' | 'repeatable'>;
const canRepeat = (tool: RepeatInfo | undefined) => !tool || tool.repeatable || (tool.effect === 'read' && tool.source !== 'agent' && tool.source !== 'user');
export const repeatableIn = (tools: ToolRegistry): Repeatable => (name) => canRepeat(tools.get(toWireName(name)));
// The same from the tools' list (ui: the catalog of those offered).
export const repeatableAmong = (tools: (RepeatInfo & Pick<Tool, 'name'>)[]): Repeatable => (name) => canRepeat(tools.find((t) => toWireName(t.name) === toWireName(name)));

// How a turn is shortened. `elements`: the page elements each action's result carries (by its call's
// id), as the tool returned them (ToolResult.elements). `repeatable`: none, every result may go as a
// note. `squeezed`: those that are not go as a note too, one that does not say to call the tool again.
interface ShortenOptions {
  elements?: ReadonlyMap<string, string>;
  repeatable?: Repeatable;
  squeezed?: boolean;
}

// The messages as this turn's next request sends them.
export function shortenRun(messages: Message[], cfg: InRun, { elements = new Map(), repeatable = () => true, squeezed = false }: ShortenOptions = {}): Message[] {
  if (!cfg.enabled) return messages;
  const from = messages.findLastIndex((m) => m.role === 'user') + 1; // the turn's: after your message
  const results: ToolResultPart[] = messages.slice(from).flatMap((m) => m.parts.filter((p): p is ToolResultPart => p.type === 'tool_result'));
  if (!results.length) return messages;
  // Whole: the latest keepResults, every result of the latest step (its calls in parallel: none the
  // model has not seen yet goes as a note), and the latest of each skill read (its instructions are
  // what the model is following).
  const lastStep = messages.findLastIndex((m) => m.role === 'assistant');
  const ofLastStep = messages.slice(lastStep + 1).flatMap((m) => m.parts.filter((p): p is ToolResultPart => p.type === 'tool_result'));
  const names = callNames(messages);
  const lastSkillReads = SKILL_READS.map((n) => results.findLast((p) => toWireName(names.get(p.toolCallId) ?? '') === n));
  const whole = new Set([...results.slice(-cfg.keepResults), ...ofLastStep, ...lastSkillReads.filter((p) => p !== undefined)]);
  const listOf = (p: ToolResultPart) => {
    const list = elements.get(p.toolCallId);
    return list && p.content.includes(list) ? list : undefined;
  };
  const lastList = results.findLast((p) => listOf(p));
  const lastShot = results.findLast((p) => p.images?.length);
  const shorten = (p: ToolResultPart): ToolResultPart => {
    // What went after it between the model's steps (memory, bookmarks) stays, as compaction leaves it.
    const { own, after } = splitAttached(p);
    let content = p.content;
    const name = names.get(p.toolCallId);
    const again = !name || repeatable(name);
    if (!whole.has(p) && own.length > cfg.minChars && (again || squeezed)) {
      content = note(resultWhat(name), own.length, !again) + after;
    } else if (cfg.lastElements && p !== lastList) {
      const list = listOf(p);
      if (list) content = content.replace(list, () => note('the page elements after an earlier action', list.length));
    }
    // Only the latest screenshot goes; its size is that of the image as it is sent (base64).
    const shots = p.images ?? [];
    const dropped = cfg.lastScreenshot ? (p === lastShot ? shots.slice(0, -1) : shots) : [];
    if (!dropped.length) return content === p.content ? p : { ...p, content };
    const { images: _images, ...rest } = p;
    const kept = shots.slice(dropped.length);
    return { ...rest, content: [content, ...dropped.map((i) => note('an earlier screenshot', i.data.length))].join('\n'), ...(kept.length && { images: kept }) };
  };
  return messages.map((m, i) => {
    if (i < from || !m.parts.some((p) => p.type === 'tool_result')) return m;
    const parts = m.parts.map((p) => (p.type === 'tool_result' ? shorten(p) : p));
    return parts.every((p, j) => p === m.parts[j]) ? m : { ...m, parts };
  });
}

// Shortened more when the request would not fit the model's window (core/agent-loop RunSeen.squeeze),
// even with shortening during a turn off: 1, only the latest SQUEEZE_KEEP tool results whole, besides
// those of the latest step and the latest skill reads (as shortenRun keeps them), and only the latest
// screenshot and page elements; 2, also the turns before this one trimmed as compaction trims them,
// every part it can (ALL_PARTS: page blocks, results, screenshots, long replies and call arguments,
// attached skills and memory). Only what is sent, as with shortenRun; the results of calls that are
// not `repeatable` go whole but at 2, as a note of their own (run.left_out_kept). This turn's calls
// keep their arguments at every level: only the turns before it have theirs left out.
export const SQUEEZE_KEEP = 1;
const SQUEEZED: InRun = { ...IN_RUN_DEFAULTS, keepResults: SQUEEZE_KEEP };

export function squeezeRun(messages: Message[], cfg: InRun, { elements, squeeze = 0, repeatable }: { elements?: ReadonlyMap<string, string>; squeeze?: 0 | 1 | 2; repeatable?: Repeatable } = {}): Message[] {
  if (!squeeze) return shortenRun(messages, cfg, { elements, repeatable });
  const run = shortenRun(messages, SQUEEZED, { elements, repeatable, squeezed: squeeze === 2 });
  const from = run.findLastIndex((m) => m.role === 'user');
  return squeeze < 2 || from <= 0 ? run : [...trimMessages(run.slice(0, from), ALL_PARTS), ...run.slice(from)];
}
