// The chat's context meter (sidepanel/ContextMeter): the last request split into what every call
// sends again (the system prompt, the tool definitions) and what grows with the conversation, what
// each part changed since the call before, and the tool definitions it sent by group.
import type { ToolInfo } from '../../core/protocol';
import { toWireName } from '../../core/tool-registry';
import type { CallUsage, ContextBreakdown } from '../../core/types';
import type { UsageTimeline } from './agent-state';
import { toolGroupSizes, type ToolGroupSize } from '../../ui/request-parts';

export interface ContextPart {
  key: keyof ContextBreakdown;
  label: string;
  fixed: boolean; // sent again with every call, the same
  tokens: number;
  delta?: number; // since the call before, when both were measured here
}

const PARTS: Omit<ContextPart, 'tokens' | 'delta'>[] = [
  { key: 'tools', label: 'Tool definitions', fixed: true },
  { key: 'system', label: 'System prompt', fixed: true },
  { key: 'pageContext', label: 'Page blocks', fixed: false },
  { key: 'toolResults', label: 'Tool results', fixed: false },
  { key: 'conversation', label: 'Messages and answers', fixed: false },
  { key: 'skills', label: 'Site skills', fixed: false },
];

// Measured from the request as it went (context/usage measureCall); a saved conversation's last call
// keeps only its total (sidepanel/agent-state usageOf).
export const measured = (u: CallUsage | undefined): u is CallUsage => !!u?.sources;

// The parts of the last request, the empty ones left out; none when it was not measured.
export function contextParts(last: CallUsage | undefined, previous?: CallUsage): ContextPart[] {
  if (!measured(last)) return [];
  const before = measured(previous) ? previous.breakdown : undefined;
  return PARTS.filter((p) => last.breakdown[p.key] > 0).map((p) => ({
    ...p,
    tokens: last.breakdown[p.key],
    ...(before && { delta: last.breakdown[p.key] - before[p.key] }),
  }));
}

// The tool definitions the last request sent, by group and tool, as the catalog has them now, scaled
// to `total` (what the request's definitions weighed, as the meter's row says) so that they add up to
// it; `others`: the tools it sent that the catalog does not list (a page's that left, one an agent
// adds), whose weight is then in the groups' share too.
export function sentToolGroups(catalog: ToolInfo[], wireNames: string[] | undefined, total?: number): { groups: ToolGroupSize[]; others: number } {
  if (!wireNames?.length) return { groups: [], others: 0 };
  const sent = new Set(wireNames);
  const tools = catalog.filter((t) => sent.has(toWireName(t.name)));
  const groups = toolGroupSizes(tools, { perTool: true });
  const sum = groups.reduce((n, g) => n + g.tokens, 0);
  const k = total && sum ? total / sum : 1;
  const scaled = k === 1 ? groups : groups.map((g) => ({ ...g, tokens: Math.round(g.tokens * k), tools: g.tools?.map((t) => ({ ...t, tokens: Math.round(t.tokens * k) })) }));
  return { groups: scaled, others: sent.size - tools.length };
}

// How the context grew: the first request, and the change of the last call from the one before
// (none across a compaction, which the chart marks instead, nor after one since the last call).
export function growth(timeline: UsageTimeline | undefined): { first?: number; delta?: number } {
  const inputs = timeline?.inputs ?? [];
  const n = inputs.length;
  const compactedBetween = timeline?.compactedAt.some((at) => at >= n - 1) ?? false;
  return {
    ...(n > 0 && { first: inputs[0]! }),
    ...(n > 1 && !compactedBetween && { delta: inputs[n - 1]! - inputs[n - 2]! }),
  };
}
