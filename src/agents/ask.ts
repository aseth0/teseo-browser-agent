// agents.ask: an agent that "Can ask" asks one that "Can be asked" (agents/profiles) to do a task.
// The other runs with its own model, tools, skills, sites and instructions, starting from the task
// alone, and only its final answer comes back, as untrusted content. The background runs it
// (runSubAgent); this file holds what the background and the chat's views share: the tool, and how
// a run fills it.
import type { JSONSchema, Message, Tool, ToolResult } from '../core/types';
import type { AgentProfile } from './profiles';
import { text } from '../core/model-texts';
import { toWireName } from '../core/tool-registry';
import { fields, optString } from '../tools/define';

export const ASK_TOOL = 'agents.ask';
export const ASK_WIRE = toWireName(ASK_TOOL);
const AGENT_LIST = '{agent_list}';

// Agents asking agents go this deep at most: the one you talk to is the first level.
export const MAX_DEPTH = 3;

const DESCRIPTION =
  'Asks another agent to do a task, and returns its answer. Each agent works with its own tools, sites and instructions, ' +
  'and does not see this conversation: put in the task everything it needs. Agents you may ask:\n' +
  AGENT_LIST;

const schema = (names: string[]): JSONSchema => ({
  type: 'object',
  properties: {
    agent: { type: 'string', enum: names, description: "The agent's name, one of those listed." },
    task: { type: 'string', description: 'What it should do or find out, with every detail it needs: it sees nothing else.' },
  },
  required: ['agent', 'task'],
});

// The list its description ends with: "- name: description".
const fillAskDescription = (description: string, callable: Pick<AgentProfile, 'name' | 'description'>[]) =>
  description.replace(AGENT_LIST, callable.map((a) => `- ${a.name}: ${a.description.trim() || '(no description)'}`).join('\n'));

// The tool as Settings → Tools lists it (its description editable there), before a run fills it in.
export const askTool = (): Tool => ({
  name: ASK_TOOL,
  description: DESCRIPTION,
  inputSchema: schema([]),
  source: 'agent',
  effect: 'read', // the other agent's own tools ask for what they do
  run: async () => ({ type: 'text', text: 'No other agent can be asked from here.', isError: true }),
});

// The tool for one run: the agents it may ask, and how it asks them.
export function askToolFor(callable: AgentProfile[], ask: (agent: AgentProfile, task: string, callId: string | undefined) => Promise<ToolResult>): Tool {
  return {
    ...askTool(),
    inputSchema: schema(callable.map((a) => a.name)),
    fillDescription: (d) => fillAskDescription(d, callable),
    run: async (args, ctx) => {
      const name = optString(fields(args).agent);
      const task = optString(fields(args).task);
      const agent = callable.find((a) => a.name === name);
      if (!agent) return { type: 'text', text: text('error.agent_not_askable', { agent_name: String(name), agents: callable.map((a) => a.name).join(', ') }), isError: true };
      if (!task?.trim()) return { type: 'text', text: text('error.agent_no_task'), isError: true };
      return ask(agent, task.trim(), ctx.callId);
    },
  };
}

// The tools a request offers, as the run fills agents.ask: left out when there is no one to ask.
export function withAsk<T extends { name: string }>(tools: T[], callable: AgentProfile[]): T[] {
  return callable.length ? tools : tools.filter((t) => t.name !== ASK_TOOL);
}

// The same for a tool spec the views build (ui/request-parts toSpec): its description and enum filled.
export function askSpec<T extends { name: string; description: string; inputSchema: JSONSchema }>(spec: T, callable: AgentProfile[]): T {
  return spec.name === ASK_WIRE ? { ...spec, description: fillAskDescription(spec.description, callable), inputSchema: schema(callable.map((a) => a.name)) } : spec;
}

// What a sub-agent answered: the text of its last reply.
export function lastAnswer(messages: Message[]): string {
  const reply = messages.findLast((m) => m.role === 'assistant' && m.parts.some((p) => p.type === 'text' && p.text.trim()));
  return (reply?.parts ?? []).flatMap((p) => (p.type === 'text' ? [p.text] : [])).join('').trim();
}
