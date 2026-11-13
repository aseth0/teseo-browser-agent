// Builder's id and the tools that create things (agents/builder), on their own so that the tools
// that check who calls them (skills, templates, tools/load) can name them without importing agents/.

// The tools that create things. While Builder is switched on they are its alone: Browser is not
// offered them, and no agent can give them to another (agents.save); only the user can.
export const CREATE_TOOLS = [
  'skills.save', 'skills.delete', 'templates.save', 'templates.delete', 'custom_tools.save', 'custom_tools.try', 'custom_tools.edit', 'custom_tools.delete',
  'actions.save', 'actions.delete', 'agents.save', 'agents.delete',
];

// The built-in skills that guide those tools (skills/create-*, manage-creations): Builder's, and
// Browser's once it loads them with the tools (tools/load).
export const CREATE_SKILLS = ['create-agent', 'create-custom-tool', 'create-page-action', 'create-script-tool', 'create-skill', 'create-template', 'manage-creations'];

// Builder: the agent that creates skills, site templates, custom tools, page widget actions and agents.
export const BUILDER_ID = 'builder';
