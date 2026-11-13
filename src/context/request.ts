// How the fixed part of every request is assembled. The background builds requests with
// these functions and the options page previews them with the same ones.
import type { Settings } from '../storage/settings';
import { skillsInstructions } from '../skills/prompt';
import { isSiteSkill, type Skill } from '../skills/types';
import { text } from '../core/model-texts';
import type { PageTemplate } from '../templates/types';
import { templatesInstructions } from '../templates/prompt';
import { HISTORY_TOOLS } from '../history/names';
import { memoryInstructions, type MemoryPromptOptions } from '../memory/prompt';
import { MEMORY_TOOLS } from '../core/memory-names';
import type { MemoryItem } from '../memory/store';
import { EMPTY_AGENT_ID } from '../agents/registry';
import { agentHasTool } from '../agents/profiles';
import { historyOn, memoryOn, mentionsOn } from '../storage/settings-select';
import { fillAboutUser } from './about-user';

interface PromptSection {
  label: string;
  origin: string; // where the text comes from, for the preview
  text: string; // empty: not sent in this request
  off: string; // why it is not sent, when it is not (for the preview)
}

// With an agent other than Browser, its instructions follow the system prompt; and one without any
// browser tool is not told about the page and its tools.
type PromptAgent = { id?: string; name: string; instructions: string; tools?: string[]; memory?: 'internal' }; // agents/profiles' AgentProfile

// What the system prompt is built from. agent: none for Browser.
interface SystemPromptInput {
  settings: Settings;
  skills: Skill[];
  templates: PageTemplate[];
  agent?: PromptAgent;
  asksAgents?: boolean; // agents.ask is offered (agents/ask)
  memory?: MemoryItem[]; // the items for the agent (memory/store memoryFor)
  memoryText?: string; // the memory part as the conversation keeps it (memory/prompt keptMemory), instead of built from `memory`
  heldSkills?: string[]; // skills not listed: those of the groups on demand not loaded yet (tools/load heldSkills), which tools.load names
}

// Every part the system message can have, in its order, each empty when it is not sent now (and why).
export function systemPromptParts({ settings, skills, templates, agent, asksAgents = false, memory = [], memoryText, heldSkills = [] }: SystemPromptInput): PromptSection[] {
  const pageTools = !agent?.tools || agent.tools.some((t) => t.startsWith('browser.'));
  // Browser's own (Settings → Agents → Browser) when the chat is with it.
  const own = agent ?? { name: 'Browser', instructions: settings.browserAgent?.instructions ?? '' };
  // Settings → About you, where {{about_user}} is.
  const instructions = fillAboutUser(own.instructions, settings.aboutUser).trim();
  const memoryOpts = memoryPromptOptions(settings, agent);
  const parts: PromptSection[] = [
    { label: 'Your system prompt', origin: 'Prompt preview', text: fillAboutUser(settings.systemPrompt, settings.aboutUser), off: 'it is empty' },
    { label: 'Agent', origin: 'Settings → Agents', text: agent || instructions ? text('system.agent', { name: own.name, instructions }).trim() : '', off: 'the chat is with Browser, which has no instructions' },
    { label: 'Page instructions', origin: 'built-in', text: pageTools ? text('system.page') : '', off: 'the agent has no browser tools' },
    { label: 'MCP servers', origin: 'enabled MCP servers', text: settings.mcpServers?.some((s) => s.enabled) ? text('system.mcp') : '', off: 'no MCP server is on' },
    { label: 'Other agents', origin: 'Settings → Agents', text: asksAgents ? text('system.agents') : '', off: 'it may not ask other agents' },
    { label: 'Plan', origin: 'Settings → Tools', text: offers(settings, 'user.plan') && (!agent?.tools || agentHasTool({ tools: agent.tools }, 'user.plan')) ? text('system.plan') : '', off: 'user.plan is not offered' },
    { label: 'Saved conversations', origin: 'Settings → History', text: readsHistory(settings) ? text('system.history') : '', off: 'the history is off, or nothing reads it' },
    { label: 'Skills', origin: 'enabled skills', text: skillsInstructions(skills.filter((s) => !heldSkills.includes(s.name))), off: 'no general skill is on' },
    { label: 'Site templates', origin: 'enabled site templates', text: templatesInstructions(templates, mentionsOn(settings, 'templates')), off: 'no site template is on' },
    { label: 'Memory', origin: 'Settings → Memory', text: memoryText ?? (memoryOpts ? memoryInstructions(memory, memoryOpts) : ''), off: 'memory is off, or it has nothing and may not save' },
  ];
  // EmptyAgent: your system prompt alone.
  return agent?.id === EMPTY_AGENT_ID ? parts.map((s, i) => (i ? { ...s, text: '', off: 'EmptyAgent gets only your system prompt' } : s)) : parts;
}

// The parts sent now.
export function systemPromptSections(input: SystemPromptInput): PromptSection[] {
  return systemPromptParts(input).filter((s) => s.text);
}

// Sections are separated by a blank line.
export function buildSystemPrompt(input: SystemPromptInput): string {
  return systemPromptSections(input)
    .map((s) => s.text)
    .join('\n\n');
}

const offers = (settings: Settings, tool: string) => !settings.disabledTools?.includes(tool);

// How the memory part is built for an agent (none: Browser); none while memory is off, and for
// EmptyAgent, which gets no memory.
export function memoryPromptOptions(settings: Settings, agent?: PromptAgent): MemoryPromptOptions | undefined {
  if (!memoryOn(settings) || agent?.id === EMPTY_AGENT_ID) return undefined;
  const internal = (agent ? agent.memory : settings.browserAgent?.memory) === 'internal';
  return { reads: offers(settings, 'memory.read'), searches: offers(settings, 'memory.search'), lists: offers(settings, 'memory.list'), saves: offers(settings, 'memory.save'), internal };
}

// Whether the model can get saved conversations: with the history on, its tools, # mentions or
// the auto-attach.
function readsHistory(settings: Settings): boolean {
  if (!historyOn(settings)) return false;
  const toolsOn = HISTORY_TOOLS.some((t) => offers(settings, t));
  return toolsOn || mentionsOn(settings, 'history') || !!settings.history?.autoAttach?.enabled;
}

// Tool names (dotted) not offered to the model: the user's choice, plus the skills tools
// when there is no general skill to load, the history tools when nothing is saved, and the memory
// tools while memory is off.
export function excludedTools(settings: Settings, skills: Skill[]): string[] {
  const hasGeneralSkills = skills.some((s) => s.enabled && !isSiteSkill(s));
  return [
    ...(settings.disabledTools ?? []),
    ...(hasGeneralSkills ? [] : ['skills.load', 'skills.read_reference']),
    ...(historyOn(settings) ? [] : HISTORY_TOOLS),
    ...(memoryOn(settings) ? [] : MEMORY_TOOLS),
  ];
}
