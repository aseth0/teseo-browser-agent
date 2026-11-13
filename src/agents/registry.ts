// The agents that act on websites. Each one has its own per-site policies (policy/store), so a new
// agent only needs an entry here to get its own Ask / Allow column in Settings → Website access.
export interface AgentInfo {
  id: string;
  name: string;
}

export const BROWSER_AGENT = 'browser';

// EmptyAgent (agents/profiles): only your system prompt, on no site.
export const EMPTY_AGENT_ID = 'empty';

// The page widget's actions (Settings → Actions) that belong to no agent: their writes, by site.
export const WIDGET_AGENT = 'widget';

export const AGENTS: AgentInfo[] = [{ id: BROWSER_AGENT, name: 'Browser agent' }, { id: WIDGET_AGENT, name: 'Page widget' }];
