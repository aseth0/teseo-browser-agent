// A turn's steps as a Mermaid diagram (the Diagrams view: Show the chat as), of the kind
// picked on its box: a sequence (you, the agent, its tools and the sub-agents it asked), a flowchart,
// a mind map, a timeline of its model calls (gantt) or its tokens by model call (pie). No React;
// ChatHistory draws it (TurnDiagram) with pele.
import type { LiveSegment } from '../../core/live';
import type { Message } from '../../core/types';
import type { TurnDiagramKind } from '../../storage/settings-types';
import { flowchartOf } from './diagrams/flowchart';
import { ganttOf } from './diagrams/gantt';
import { mindmapOf } from './diagrams/mindmap';
import { pieOf } from './diagrams/pie';
import { sequenceOf } from './diagrams/sequence';
import { countsOf, turnStepsOf, type DiagramCounts, type Step } from './turn-steps';
import { typedText, type ToolResultPart } from './turns';

// The kinds a turn can be drawn as, on the box's buttons: a short name, and what it draws.
export const TURN_DIAGRAM_KINDS: [TurnDiagramKind, string, string][] = [
  ['sequence', 'Sequence', 'Sequence: you, the agent, its tools and the agents it asked'],
  ['flowchart', 'Flow', 'Flowchart: each step a box, top to bottom'],
  ['mindmap', 'Mind map', 'Mind map: thoughts, tools by group and agents'],
  ['gantt', 'Timeline', 'Timeline of the model calls, and what ran between them'],
  ['pie', 'Tokens', 'Tokens by model call, in + out'],
];

// The kind saved, or the sequence for one this build does not know (saved by a newer build).
export const diagramKindOf = (saved: string | undefined): TurnDiagramKind => TURN_DIAGRAM_KINDS.find(([k]) => k === saved)?.[0] ?? 'sequence';

// A diagram's source; or, when the turn has nothing to draw of that kind, why (`none`).
interface TurnDiagramSource {
  source?: string;
  none?: string;
  counts: DiagramCounts;
}

export interface TurnInput {
  user?: Message;
  messages: Message[]; // the turn's model messages and tool results, its answer's included (turnsOf)
  steps: Message[]; // those before its answer
  results: Map<string, ToolResultPart>;
  answered: boolean;
  stopped?: boolean;
  running?: boolean;
  live?: LiveSegment[]; // what the model streams now, while it runs
  reasoning?: boolean; // the reasoning drawn (default: yes; Settings → Reasoning: Hidden, no)
}

// The diagram of a turn, of `kind`.
export function turnDiagramOf(kind: TurnDiagramKind, input: TurnInput): TurnDiagramSource {
  const { user, steps, results, running = false, live = [], reasoning = true } = input;
  const done = turnStepsOf(steps, results, { reasoning, running });
  const counts = countsOf(done);
  // While it runs, what streams goes last: the reasoning by its end (a loop shows at once).
  const now: Step[] = running
    ? live.flatMap((s): Step[] => (!s.text.trim() ? [] : s.kind === 'reasoning' ? (reasoning ? [{ kind: 'thought', text: s.text, live: true }] : []) : [{ kind: 'text', text: s.text, live: true }]))
    : [];
  const all = [...done, ...now];
  const typed = user ? typedText(user) || 'Your message' : undefined;
  const turn = { typed, steps: all, answered: input.answered, stopped: !!input.stopped };
  switch (kind) {
    case 'flowchart': return { source: flowchartOf(turn), counts };
    case 'mindmap': return { source: mindmapOf(turn), counts };
    case 'gantt': return { ...ganttOf(input.messages), counts };
    case 'pie': return { ...pieOf(input.messages), counts };
    default: return { source: sequenceOf(turn), counts };
  }
}
