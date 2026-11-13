// The agent of the chat floating on a page while it shows the pinned conversation (widget/protocol
// STICKY_CHAT): its own, as in the agent manager (manager-chat ownAgentSettings), never the settings'
// (the side panel's and every other chat's). It starts as the agent of the page's site (sticky
// stickyAgentId) and changes with the chat's picker; so each tab answers with its own site's agent,
// whichever tab was shown last. Showing any other conversation, the chat has the settings' agent, as before.
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { SettingsContext, useSettingsContext, type SettingsValue } from '../../ui/settings-context';
import { ownAgentSettings, type ManagerChoice } from './manager-chat';

// Its own agent (none: Browser), or the settings' again (null); and the settings with their own agent
// (`outer`), for a conversation opened with it.
type SetOwnAgent = (agentId: string | undefined | null) => void;
const OwnAgentContext = createContext<{ setOwnAgent: SetOwnAgent; outer: SettingsValue } | null>(null);
export function useOwnAgent() {
  const own = useContext(OwnAgentContext);
  const outer = useSettingsContext();
  return own ?? { setOwnAgent: NO_OWN_AGENT, outer };
}
const NO_OWN_AGENT: SetOwnAgent = () => {};

export function FloatingScope({ children }: { children: ReactNode }) {
  const outer = useSettingsContext();
  const [own, setOwn] = useState<ManagerChoice | null>(null);
  const latest = useRef(own);
  const choose = useCallback((next: ManagerChoice | null) => {
    latest.current = next;
    setOwn(next);
  }, []);
  const value = useMemo(() => (own ? ownAgentSettings(outer, own, latest, choose) : outer), [outer, own, choose]);
  const setOwnAgent = useCallback<SetOwnAgent>((agentId) => {
    if (agentId === null ? latest.current !== null : latest.current?.agentId !== agentId || !latest.current) choose(agentId === null ? null : { agentId });
  }, [choose]);
  const own_ = useMemo(() => ({ setOwnAgent, outer }), [setOwnAgent, outer]);
  return (
    <OwnAgentContext.Provider value={own_}>
      <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>
    </OwnAgentContext.Provider>
  );
}
