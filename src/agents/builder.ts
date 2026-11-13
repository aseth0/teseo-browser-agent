// Builder: the agent that creates skills, site templates, custom tools, page widget actions and
// agents. It comes switched off and with no sites, and the user edits it like any other (it is
// stored once changed); it cannot be deleted, nor changed by an agent.
import { BUILDER_ID, CREATE_SKILLS, CREATE_TOOLS } from '../core/builder-ids';
import type { AgentProfile } from './profiles';

// What a Builder stored before builderSkills existed came with.
const FIRST_BUILDER_SKILLS = CREATE_SKILLS.filter((s) => !['create-script-tool', 'manage-creations'].includes(s));
const BUILDER_TOOLS = [
  ...CREATE_TOOLS, 'agents.catalog', 'actions.read', 'custom_tools.read', 'skills.read', 'templates.load', 'templates.run',
  'browser.find', 'browser.find_in_dom', 'browser.get_html', 'browser.get_page_text', 'browser.get_structured_data', 'browser.list_tabs', 'browser.read_page', 'browser.screenshot',
  'browser.site_access', 'user.ask', 'user.pick_element', 'web.read', 'web.search',
  // Acting on the page, to learn how a site works: each action asks as the site's policy says.
  'browser.click', 'browser.navigate', 'browser.press_key', 'browser.scroll', 'browser.select', 'browser.type',
].sort();
// And before builderTools existed (the tools it came with in its first versions).
const FIRST_BUILDER_TOOLS = [
  'skills.save', 'templates.save', 'custom_tools.save', 'actions.save', 'agents.save', 'agents.catalog', 'templates.load', 'templates.run',
  'browser.find', 'browser.get_page_text', 'browser.get_structured_data', 'browser.list_tabs', 'browser.read_page', 'browser.screenshot',
  'browser.site_access', 'user.ask', 'user.pick_element', 'web.read', 'web.search',
];
export const builderProfile = (): AgentProfile => ({
  id: BUILDER_ID,
  enabled: false,
  name: 'Builder',
  icon: '🛠️',
  description: 'Creates, updates and deletes skills, site templates, custom tools, page widget actions and agents, each reviewed by the user.',
  instructions: '',
  tools: [...BUILDER_TOOLS],
  builderTools: [...BUILDER_TOOLS],
  skills: [...CREATE_SKILLS],
  builderSkills: [...CREATE_SKILLS],
  templates: [],
  sites: {},
  canAsk: false,
  canBeAsked: false,
});

// A stored Builder gets the skills and tools it comes with that are new since it was stored; one the
// user took away stays away.
export function upgradeBuilder(a: AgentProfile): AgentProfile {
  const known = a.builderSkills ?? FIRST_BUILDER_SKILLS;
  const added = CREATE_SKILLS.filter((s) => !known.includes(s) && !a.skills.includes(s));
  const knownTools = a.builderTools ?? FIRST_BUILDER_TOOLS;
  const addedTools = BUILDER_TOOLS.filter((t) => !knownTools.includes(t) && !a.tools.includes(t));
  return { ...a, skills: [...a.skills, ...added], builderSkills: [...CREATE_SKILLS], tools: [...a.tools, ...addedTools], builderTools: [...BUILDER_TOOLS] };
}

export const builderOn = (agents: AgentProfile[]) => agents.some((a) => a.id === BUILDER_ID && a.enabled);
