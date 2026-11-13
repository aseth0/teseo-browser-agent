// The agent the chat talks to (Settings → Agents): Browser, EmptyAgent, or one of the user's, each with only the
// tools and skills it was given. The choice is kept in the settings and with each conversation; on
// an agent's site the chat changes to it (useSiteAgent).
import { useEffect, useMemo, useRef } from 'react';
import { agentById, agentStore, orderedAgentIds, siteSwitch, type AgentProfile } from '../../agents/profiles';
import { browserAsAgent, DEFAULT_AGENT_ID, EMPTY_AGENT } from '../../agents/builtins';
import { Icon } from '../../ui/chat-icons';
import { Popover } from '../../ui/Popover';
import { hostOf } from '../../core/util';
import type { Settings } from '../../storage/settings';
import { openOptions } from '../../ui/open-options';
import { useCollection, useCollectionState } from '../../ui/useCollection';
import type { SettingsUpdate } from '../../ui/useSettings';
import { useSettingsContext } from '../../ui/settings-context';
import { MANAGER } from '../../ui/floating-frame';

// The agents switched on, and the one chosen (none: Browser).
// The same list until the agents change, so what is worked out from it is not made again on every render.
export function useActiveAgent(settings: Settings): { agents: AgentProfile[]; agent?: AgentProfile } {
  const all = useCollection(agentStore);
  const agents = useMemo(() => all.filter((a) => a.enabled), [all]);
  return { agents, agent: agentById(agents, settings.activeAgentId) };
}

// On reaching an agent's site (the first that has it), the chat changes to that agent: from Browser, or
// from the agent a site chose unless it has this one too, never from one chosen by hand. Once per
// site: an agent given the site meanwhile (a sub-agent's "Always" on a card) does not move it. Never
// during a turn, nor in the agent manager (its chat's agent is the one chosen for it). `onSwitch`: it changed.
export function useSiteAgent(url: string | undefined, busy: boolean, settings: Settings, onChange: SettingsUpdate, onSwitch?: (agent: AgentProfile) => void) {
  const { items: all, loaded } = useCollectionState(agentStore);
  const host = hostOf(url);
  const seen = useRef('');
  const bySite = useRef<string | undefined>(undefined); // the agent the last switch chose, while chosen
  useEffect(() => {
    if (settings.activeAgentId !== bySite.current) bySite.current = undefined;
  }, [settings.activeAgentId]);
  useEffect(() => {
    if (MANAGER || busy || !loaded || host === seen.current) return;
    seen.current = host;
    const owner = host ? siteSwitch(all, host, settings.activeAgentId, bySite.current) : undefined;
    if (!owner || owner.id === settings.activeAgentId) return;
    bySite.current = owner.id;
    onChange({ activeAgentId: owner.id });
    onSwitch?.(owner);
  }, [host, busy, loaded, all, settings.activeAgentId, onChange, onSwitch]);
}

// The agents to choose from, in the order of Settings → Agents: Browser and EmptyAgent among those switched on.
export function agentChoices(agents: AgentProfile[], settings: Settings): AgentProfile[] {
  const browserAgent = browserAsAgent(settings);
  return orderedAgentIds(agents, settings.agentOrder)
    .map((id) => (id === DEFAULT_AGENT_ID ? browserAgent : id === EMPTY_AGENT.id ? EMPTY_AGENT : agents.find((a) => a.id === id)))
    .filter((a) => !!a);
}

interface Props {
  agents: AgentProfile[];
  agent?: AgentProfile;
  disabled?: boolean;
}

// A button with the agent's icon and name, like the chat's other menus: it opens the agents, each
// with its description, in the order of Settings → Agents, then Manage agents….
export function AgentPicker({ agents, agent, disabled }: Props) {
  const { settings, update: onChange } = useSettingsContext();
  const chosen = agent ?? browserAsAgent(settings);
  const choices = agentChoices(agents, settings);
  const choose = (id: string) => onChange({ activeAgentId: id === DEFAULT_AGENT_ID ? undefined : id });
  return (
    <div className={`agent-picker${disabled ? ' disabled' : ''}`}>
      <Popover title={`Agent: ${chosen.name}${chosen.description ? ` — ${chosen.description}` : ''}`} label={<><AgentIcon agent={chosen} /><span className="agent-picker-name">{chosen.name}</span></>}>
        {(close) => (
          <div className="menu agent-menu" role="menu" aria-label="Agents">
            {choices.map((a) => (
              <button key={a.id} role="menuitemradio" aria-checked={a.id === chosen.id} className="menu-option agent-option" disabled={disabled}
                onClick={() => { choose(a.id); close(); }}>
                <AgentIcon agent={a} />
                <span className="agent-option-text">
                  <span>{a.name}</span>
                  {a.description && <span className="muted small">{a.description}</span>}
                </span>
              </button>
            ))}
            <button role="menuitem" className="menu-option" onClick={() => { close(); void openOptions('agents'); }}>Manage agents…</button>
          </div>
        )}
      </Popover>
    </div>
  );
}

// An agent's own icon (an emoji); one without, the robot.
const AgentIcon = ({ agent }: { agent: Pick<AgentProfile, 'icon'> }) =>
  agent.icon?.trim() ? <span className="agent-emoji" aria-hidden="true">{agent.icon.trim()}</span> : <Icon name="agent" size={14} />;
