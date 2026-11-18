// Pieces of a request to the model as the chat builds it, and how the views label them.
// Shared by the side panel and the options page.
import { estimateTokens } from '../context/budget';
import { excludedTools, memoryPromptOptions } from '../context/request';
import { toolDescription } from '../core/model-texts';
import type { ToolInfo } from '../core/protocol';
import { resolveThinkingParam, thinkingBody } from '../providers/thinking';
import type { Skill } from '../skills/types';
import type { Settings } from '../storage/settings';
import { activeTarget, thinkingLevel } from '../storage/settings-select';
import { toWireName } from '../core/tool-registry';
import { toOpenAITools } from '../providers/wire';
import { toolGroupLabel } from './Tools';
import { toolGroup } from '../core/tool-groups';
import { agentOffers, callableAgents, seenBy, type AgentProfile } from '../agents/profiles';
import { askSpec, withAsk } from '../agents/ask';
import { panelSpec, withPanel } from '../agents/panel';
import type { PageTemplate } from '../templates/types';
import { memoryFor, type MemoryItem } from '../memory/store';
import { repeatableAmong } from '../context/in-run';
import { requestView } from '../context/request-view';
import type { RequestViewOf } from '../context/request-view';
import { hasCreateGroup } from '../agents/builtins';
import type { Message } from '../core/types';
import { heldSkills, offeredOnDemand, onDemandGroups } from '../tools/load';
import { heldFor } from '../tools/match';

// The request fields besides messages and tools, as the chat would send them: the active model
// and its thinking level.
export function requestHead(settings: Settings, agent?: { providerId?: string; model?: string }): Record<string, unknown> {
  const { provider, model } = activeTarget(settings, agent);
  const level = provider && thinkingLevel(settings, provider.id, model);
  const thinking = provider && level ? thinkingBody(resolveThinkingParam(provider.thinkingParam, provider.baseURL), level) : {};
  return { model: model || '{model}', stream: true, ...thinking };
}

// The tools the model is offered with these settings and skills.
const offeredTools = (catalog: ToolInfo[], settings: Settings, skills: Skill[]) => {
  const excluded = new Set(excludedTools(settings, skills));
  return catalog.filter((t) => !excluded.has(t.name));
};

export const toSpec = (t: ToolInfo & { ownText?: boolean }) => ({ name: toWireName(t.name), description: t.ownText ? t.description : toolDescription(t.name, t.description), inputSchema: t.inputSchema });

// What a request is built from, as an agent sees it (none: Default), like the background builds it:
// its settings, skills and site templates, the tools it is offered (agents.ask filled with those it
// may ask), whether it may ask any (the system prompt says so), its memory items and what it may do with them.
// `panel`: in a chat of the Agents Panel the user started (the panel's tools too, agents/panel).
// `history`: the conversation so far, for the groups on demand it loaded (tools/load), and the skills
// the system prompt leaves out meanwhile (`heldSkills`, for buildSystemPrompt).
export function requestAs(agent: AgentProfile | undefined, settings: Settings, all: { skills: Skill[]; templates: PageTemplate[]; catalog: ToolInfo[]; agents: AgentProfile[]; memory: MemoryItem[] }, panel = false, history: Message[] = []) {
  const seen = seenBy(agent, settings, all.skills, all.templates);
  const callable = callableAgents(agent, all.agents, settings);
  const tools = offeredTools(withPanel(withAsk(agentOffers(agent, all.catalog, all.agents), callable), panel && callable.length > 0), seen.settings, seen.skills);
  const onDemand = onDemandGroups(settings, tools, { create: hasCreateGroup(agent), skills: seen.skills });
  // With the tool groups your last message did not match held back too, as the run did (tools/match).
  const groups = [...onDemand, ...heldFor(history, tools, onDemand)];
  const offered = offeredOnDemand(tools, history, groups) as ToolInfo[];
  return { ...seen, offered, specs: offered.map((t) => panelSpec(askSpec(toSpec(t), callable), callable)), asks: callable.length > 0, memory: memoryFor(all.memory, agent?.id), memoryOpts: memoryPromptOptions(seen.settings, agent), heldSkills: heldSkills(groups, history) };
}

// What a request carries of its conversation, as the run builds it (context/request-view), with
// `offered` the tools whose results cannot be had again by calling them again.
export function viewFor(settings: Settings, offered: ToolInfo[]): RequestViewOf {
  const repeatable = repeatableAmong(offered);
  return (system, history) => requestView(settings, system, history, { repeatable });
}

// The tools offered, by group (as the tools menu groups them), with what their definitions weigh:
// the heaviest first. `perTool`: in each group its tools too, the heaviest first, the group weighing
// what they add up to (each definition weighed once).
export interface ToolGroupSize {
  group: string;
  label: string;
  count: number;
  tokens: number;
  tools?: { name: string; tokens: number }[];
}
const specTokens = (tools: ToolInfo[]) => estimateTokens(JSON.stringify(toOpenAITools(tools.map(toSpec))));
export function toolGroupSizes(tools: ToolInfo[], { perTool = false } = {}): ToolGroupSize[] {
  return Object.entries(Object.groupBy(tools, toolGroup))
    .map(([group, list]): ToolGroupSize => {
      const head = { group, label: toolGroupLabel(group), count: list!.length };
      if (!perTool) return { ...head, tokens: specTokens(list!) };
      const each = list!.map((t) => ({ name: t.name, tokens: specTokens([t]) })).sort((a, b) => b.tokens - a.tokens);
      return { ...head, tokens: each.reduce((n, t) => n + t.tokens, 0), tools: each };
    })
    .sort((a, b) => b.tokens - a.tokens);
}

export const labelled = (items: [string, string][]) => items.map(([label, t]) => `--- ${label} ---\n${t}`).join('\n\n');

export const tokensLabel = (n: number) => `~${n.toLocaleString('en-US')} tokens`;
export const textTokens = (s: string) => tokensLabel(estimateTokens(s));
