import { labelOf, STATUS, textLabel, thoughtLabel, type Drawn, type Step } from '../turn-steps';

// A label as the text of a flowchart arrow (`-->|text|`), where brackets and bars are syntax too.
const arrowLabel = (label: string) => label.replace(/[()[\]|]/g, (c) => `#${c.charCodeAt(0)};`);

// Each step a node, top to bottom: thoughts and texts as boxes, calls as subroutines with their
// result on the arrow out, an agent asked as a group of its own steps.
export function flowchartOf(turn: Drawn): string {
  const lines = ['flowchart TD'];
  let n = 0;
  let prev: string | undefined;
  let edge = ''; // the label of the arrow out of `prev`
  const node = (shape: string) => {
    const id = `n${++n}`;
    lines.push(`${id}${shape}`);
    if (prev) lines.push(`${prev} -->${edge ? `|${arrowLabel(edge)}|` : ''} ${id}`);
    prev = id;
    edge = '';
    return id;
  };
  const by = (steps: Step[]) => {
    for (const s of steps) {
      if (s.kind === 'thought') node(`["${thoughtLabel(s)}"]`);
      else if (s.kind === 'text') node(`["${textLabel(s)}"]`);
      else if (s.agent) {
        node(`[["🤖 ${labelOf(s.name)}"]]`);
        if (s.agent.steps.length) {
          lines.push(`subgraph g${n} ["${labelOf(s.agent.label, 20)}"]`);
          by(s.agent.steps);
          lines.push('end');
        }
        edge = s.status === 'error' ? '✗' : labelOf(s.agent.answer, 20);
      } else {
        node(`[["${labelOf(s.name)}"]]`);
        edge = s.status === 'error' && s.error ? `✗ ${labelOf(s.error, 20)}` : STATUS[s.status];
      }
    }
  };
  if (turn.typed) node(`(["You: ${labelOf(turn.typed)}"])`);
  by(turn.steps);
  if (turn.answered) node('(["Answer ↓"])');
  if (turn.stopped) node('(["Stopped by you"])');
  return lines.join('\n');
}
