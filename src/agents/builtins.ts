// The agents that come built in and are not stored: Browser, the chat as it always was (set up in
// Settings → Tools, Skills and Website access), and EmptyAgent. Builder is built in too, but stored
// once changed (agents/builder).
import type { Settings } from '../storage/settings';
import type { AgentProfile } from './profiles';
import { BROWSER_AGENT, EMPTY_AGENT_ID } from './registry';

export const DEFAULT_AGENT_ID = BROWSER_AGENT;
// Whether an agent has the group `create` on demand (tools/load): Browser, as the chat (none) or as
// another agent asks it.
export const hasCreateGroup = (who: { id: string } | undefined) => !who || who.id === DEFAULT_AGENT_ID;
// Browser, the chat as it always was (not stored), by its name; "Default", its name before, still finds it.
export const DEFAULT_AGENT_NAME = 'Browser';
export const DEFAULT_AGENT_ICON = '🌐';
export const DEFAULT_BROWSER_DESCRIPTION = 'The chat as always: every tool and skill switched on, every site with its policy.';
// Browser as other agents ask it (its "Can be asked"): what the user set for it, on every site with
// the sites' policies. Its tools, skills and site templates are those switched on: browserWith fills them.
export const browserAsAgent = (settings: Pick<Settings, 'browserAgent' | 'defaultCanAsk'>): AgentProfile => ({
  id: DEFAULT_AGENT_ID,
  enabled: true,
  name: DEFAULT_AGENT_NAME,
  icon: settings.browserAgent?.icon ?? DEFAULT_AGENT_ICON,
  description: settings.browserAgent?.description?.trim() || DEFAULT_BROWSER_DESCRIPTION,
  instructions: settings.browserAgent?.instructions ?? '',
  ...(settings.browserAgent?.memory === 'internal' && { memory: 'internal' as const }),
  ...(settings.browserAgent?.voiceProfileId && { voiceProfileId: settings.browserAgent.voiceProfileId }),
  ...(settings.browserAgent?.canSpeak && { canSpeak: true }),
  tools: [],
  skills: [],
  templates: [],
  sites: {},
  canAsk: !!settings.defaultCanAsk,
  canBeAsked: true,
});
// And with what is switched on now: the tools Browser is offered (by name), the skills and site templates.
export const browserWith = (settings: Settings, toolNames: string[], skills: { name: string; enabled: boolean }[], templates: { name: string; enabled: boolean }[]): AgentProfile => ({
  ...browserAsAgent(settings),
  tools: toolNames.filter((n) => !settings.disabledTools?.includes(n)),
  skills: skills.filter((s) => s.enabled).map((s) => s.name),
  templates: templates.filter((t) => t.enabled).map((t) => t.name),
});
export const DEFAULT_NAMES = ['browser', 'default'];

// EmptyAgent: built in, always there, not stored nor changed. It gets your system prompt and nothing
// else: no tools, skills, site templates, sites, page, memory or mentions (isEmptyAgent).
export const EMPTY_AGENT: AgentProfile = {
  id: EMPTY_AGENT_ID,
  enabled: true,
  name: 'EmptyAgent',
  icon: '⬜',
  description: 'Only your system prompt: no tools, skills, sites, page or memory.',
  instructions: '',
  tools: [],
  skills: [],
  templates: [],
  sites: {},
  onlyItsSites: true,
  canAsk: false,
  canBeAsked: false,
};
export const isEmptyAgent = (a: { id?: string } | undefined) => a?.id === EMPTY_AGENT_ID;
