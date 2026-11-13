import { labelOf, STATUS, type Drawn } from '../turn-steps';

// A tool's group and its name in it: split at the first "__" (an MCP server's tools keep the rest,
// "__" and all), or else at the first ".".
export function groupOf(tool: string): [string, string] {
  const at = tool.includes('__') ? tool.indexOf('__') : tool.indexOf('.');
  if (at < 0) return ['other', tool];
  return [tool.slice(0, at), tool.slice(at + (tool.startsWith('__', at) ? 2 : 1))];
}

// The turn in the middle; its thoughts, its tools by group, the agents it asked and what it wrote
// along the way as branches.
export function mindmapOf(turn: Drawn): string {
  const lines = ['mindmap', `  root(("${turn.typed ? labelOf(turn.typed, 24) : 'Turn'}"))`];
  const leaf = (depth: number, text: string) => lines.push(`${'  '.repeat(depth)}["${text}"]`);
  const branch = (title: string, items: string[]) => {
    if (!items.length) return;
    lines.push(`    ${title}`);
    for (const item of items.slice(0, 8)) leaf(3, item);
    if (items.length > 8) leaf(3, `+${items.length - 8} more`);
  };
  const calls = turn.steps.filter((s) => s.kind === 'call');
  branch('💭 Thoughts', turn.steps.flatMap((s) => (s.kind === 'thought' ? [labelOf(s.text, 28, { tail: s.live })] : [])));
  // Tools by group (the part of their name before "__" or "."), each with how many times and how.
  const groups = new Map<string, Map<string, string[]>>();
  for (const c of calls) {
    if (c.agent) continue;
    const [group, name] = groupOf(c.name);
    const byName = groups.get(group) ?? new Map<string, string[]>();
    byName.set(name, [...(byName.get(name) ?? []), STATUS[c.status]]);
    groups.set(group, byName);
  }
  if (groups.size) {
    lines.push('    🔧 Tools');
    for (const [group, byName] of groups) {
      lines.push(`      ["${labelOf(group, 20)}"]`);
      for (const [name, how] of byName) leaf(4, `${labelOf(name, 24)}${how.length > 1 ? ` ×${how.length}` : ''} ${[...new Set(how)].join(' ')}`);
    }
  }
  branch('🤖 Agents', calls.flatMap((c) => (c.agent ? [`${labelOf(c.agent.label, 20)} ${STATUS[c.status]}`] : [])));
  branch('✍ Written', turn.steps.flatMap((s) => (s.kind === 'text' && !s.live ? [labelOf(s.text, 28)] : [])));
  if (turn.answered) lines.push('    ✓ Answer');
  if (turn.stopped) lines.push('    ✗ Stopped by you');
  return lines.join('\n');
}
