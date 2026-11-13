// A turn's steps and model calls, as every diagram of it draws them (ui/chat/turn-diagram), and its
// texts as labels of a diagram.
import { stripMarks } from '../../core/model-texts';
import type { Message } from '../../core/types';
import { toolResultsById, type ToolResultPart } from './turns';

const LABEL_MAX = 32;

// A text as one label of the diagram: on one line, cut to `max` characters (from its end with
// `tail`), and with what Mermaid reads as syntax (#, ;, %, <, >, {, }, ", and : with `colon`)
// written as entity codes, so a tool's arguments or the model's text never break the diagram or
// add to it.
export function labelOf(text: string, max = LABEL_MAX, { tail = false, colon = false }: { tail?: boolean; colon?: boolean } = {}): string {
  const line = stripMarks(text).replace(/\s+/g, ' ').trim();
  const chars = [...line];
  const cut = chars.length <= max ? line : tail ? `…${chars.slice(-(max - 1)).join('')}` : `${chars.slice(0, max - 1).join('')}…`;
  return cut.replace(colon ? /[#;%<>{}":]/g : /[#;%<>{}"]/g, (c) => `#${c.charCodeAt(0)};`);
}

// What the diagram counts of a turn, for its summary line.
export interface DiagramCounts {
  thoughts: number;
  tools: number;
  errors: number;
  agents: number;
}

// A turn's steps in order, as every kind draws them.
export type Step =
  | { kind: 'thought'; text: string; live?: boolean }
  | { kind: 'text'; text: string; live?: boolean }
  | { kind: 'call'; name: string; status: 'ok' | 'error' | 'running' | 'not-run'; error?: string; agent?: { label: string; steps: Step[]; answer: string } };

// The steps of `messages`, their results looked up in `found`: the reasoning too with `reasoning`, a
// call with no result yet as running while `running`; inside a sub-agent (`nested`), not its own
// sub-agents' runs.
interface StepsOptions {
  reasoning: boolean;
  running: boolean;
  nested?: boolean;
}
export function turnStepsOf(messages: Message[], found: Map<string, ToolResultPart>, { reasoning, running, nested = false }: StepsOptions): Step[] {
  const out: Step[] = [];
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const p of m.parts) {
      if (p.type === 'reasoning' && p.text.trim() && reasoning) out.push({ kind: 'thought', text: p.text });
      else if (p.type === 'text' && p.text.trim() && !nested) out.push({ kind: 'text', text: p.text });
      else if (p.type === 'tool_call') {
        const result = found.get(p.id);
        const status = !result ? (running ? 'running' : 'not-run') : result.isError ? 'error' : 'ok';
        const trace = result?.trace && !result.trace.steps && !nested ? result.trace : undefined;
        out.push({
          kind: 'call',
          name: p.name,
          status,
          error: result?.isError ? result.content : undefined,
          agent: trace && { label: trace.agent, steps: turnStepsOf(trace.messages, toolResultsById(trace.messages), { reasoning, running, nested: true }), answer: result!.content },
        });
      }
    }
  }
  return out;
}

export const countsOf = (steps: Step[]): DiagramCounts => ({
  thoughts: steps.filter((s) => s.kind === 'thought' && !s.live).length,
  tools: steps.filter((s) => s.kind === 'call').length,
  errors: steps.filter((s) => s.kind === 'call' && s.status === 'error').length,
  agents: steps.filter((s) => s.kind === 'call' && s.agent).length,
});

export const STATUS: Record<Extract<Step, { kind: 'call' }>['status'], string> = { ok: '✓', error: '✗', running: '⏳ running…', 'not-run': 'not run' };

export interface Drawn {
  typed?: string;
  steps: Step[];
  answered: boolean;
  stopped: boolean;
}

export const thoughtLabel = (s: Extract<Step, { kind: 'thought' }>) => `💭 ${labelOf(s.text, LABEL_MAX, { tail: s.live })}`;
export const textLabel = (s: Extract<Step, { kind: 'text' }>) => (s.live ? '✍ writing…' : `✍ ${labelOf(s.text)}`);

// The turn's model calls with their timing (how they went: MessageMeta), each with the tools it called.
export function modelCalls(messages: Message[]) {
  return messages.flatMap((m) => (m.role === 'assistant' && m.meta ? [{ meta: m.meta, tools: m.parts.flatMap((p) => (p.type === 'tool_call' ? [p.name] : [])) }] : []));
}

export const NO_TIMING = 'No model call of this turn has its timing (older conversations, or still running its first call).';
