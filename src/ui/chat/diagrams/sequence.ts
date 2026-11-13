import { labelOf, STATUS, textLabel, thoughtLabel, type Drawn, type Step } from '../turn-steps';

// You, the agent, its tools and a column for each agent it asked; reasoning as notes, calls and
// results as arrows.
export function sequenceOf(turn: Drawn): string {
  const agents = new Map<string, string>(); // a sub-agent's label → its participant
  const body: string[] = [];
  const by = (steps: Step[], who: string) => {
    for (const s of steps) {
      if (s.kind === 'thought') body.push(`Note over ${who}: ${thoughtLabel(s)}`);
      else if (s.kind === 'text') body.push(`A-->>You: ${textLabel(s)}`);
      else if (s.agent) {
        let sub = agents.get(s.agent.label);
        if (!sub) agents.set(s.agent.label, (sub = `S${agents.size + 1}`));
        body.push(`A->>${sub}: ${labelOf(s.name)}`, `activate ${sub}`);
        by(s.agent.steps, sub);
        body.push(s.status === 'error' ? `${sub}--xA: ✗ ${labelOf(s.agent.answer, 24)}` : `${sub}-->>A: ${labelOf(s.agent.answer)}`, `deactivate ${sub}`);
      } else {
        body.push(`${who}->>T: ${labelOf(s.name)}`);
        const back = s.status === 'ok' || s.status === 'running' ? '-->>' : '--x';
        body.push(`T${back}${who}: ${STATUS[s.status]}${s.error ? ` ${labelOf(s.error, 24)}` : ''}`);
      }
    }
  };
  by(turn.steps, 'A');
  if (turn.answered) body.push('A-->>You: Answer ↓');
  if (turn.stopped) body.push('Note over You,A: Stopped by you');
  return [
    'sequenceDiagram',
    'actor You',
    'participant A as Agent',
    'participant T as Tools',
    ...[...agents].map(([label, id]) => `participant ${id} as ${labelOf(label, 20)}`),
    ...(turn.typed ? [`You->>A: ${labelOf(turn.typed)}`] : []),
    ...body,
  ].join('\n');
}
