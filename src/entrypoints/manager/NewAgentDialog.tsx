// "+ New agent": the tab it will work on (not the manager's, nor one another row works on) and its agent;
// from the history, to go on with a saved conversation (`conversation`), with its agent at first.
import { useEffect, useId, useState } from 'react';
import { browser } from 'wxt/browser';
import { agentLabel, agentStore } from '../../agents/profiles';
import { DEFAULT_AGENT_ID } from '../../agents/builtins';
import type { Settings } from '../../storage/settings';
import { useCollection } from '../../ui/useCollection';
import { agentChoices } from '../sidepanel/AgentPicker';
import { tabChoices, type TabChoice } from '../../manager/tabs';
import type { ConversationMeta } from '../../history/store';
import { plainTitle } from '../../history/title-links';

export function NewAgentDialog({ settings, taken, conversation, onStart, onClose }: {
  settings: Settings;
  taken: number[];
  conversation?: Pick<ConversationMeta, 'id' | 'title' | 'agentId'>;
  onStart: (tabId: number, agentId: string | undefined) => void;
  onClose: () => void;
}) {
  const all = useCollection(agentStore);
  const agents = agentChoices(all.filter((a) => a.enabled), settings);
  const [tabs, setTabs] = useState<TabChoice[]>();
  const [tabId, setTabId] = useState<number>();
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);
  // Going on with a saved conversation: its agent, once the agents are read and while it is one of them.
  // The dialog is made anew for each conversation (its key).
  const ownAgent = agents.find((a) => a.id === conversation?.agentId)?.id;
  useEffect(() => {
    if (ownAgent) setAgentId(ownAgent);
  }, [ownAgent]);
  const label = conversation ? `Continue: ${plainTitle(conversation.title)}` : '+ New agent';
  const id = useId(); // labels apart from their field: one around it would name it with the option shown too
  const takenKey = taken.join(',');
  useEffect(() => {
    let current = true;
    void Promise.all([browser.tabs.query({ windowType: 'normal' }), browser.tabs.getCurrent()]).then(([open, own]) => {
      if (!current) return;
      const choices = tabChoices(open, own?.id, takenKey ? takenKey.split(',').map(Number) : []);
      setTabs(choices);
      // The tab chosen stays while it can still be chosen: a row added or removed meanwhile changes nothing.
      setTabId((chosen) => (choices.some((t) => t.id === chosen) ? chosen : choices[0]?.id));
    });
    return () => {
      current = false;
    };
  }, [takenKey]);
  return (
    <form className="manager-new" role="dialog" aria-label={label}
      onKeyDown={(e) => e.key === 'Escape' && onClose()}
      onSubmit={(e) => {
        e.preventDefault();
        if (tabId !== undefined) onStart(tabId, agentId === DEFAULT_AGENT_ID ? undefined : agentId);
      }}>
      {conversation && <div className="manager-field manager-continue"><span>Continue</span><strong>{plainTitle(conversation.title)}</strong></div>}
      <div className="manager-field">
        <label htmlFor={`${id}-tab`}>Work on tab</label>
        <select id={`${id}-tab`} autoFocus value={tabId ?? ''} onChange={(e) => setTabId(Number(e.target.value))}>
          {tabs?.map((t) => <option key={t.id} value={t.id}>{t.host ? `${t.title} — ${t.host}` : t.title}</option>)}
        </select>
      </div>
      <div className="manager-field">
        <label htmlFor={`${id}-agent`}>Agent</label>
        <select id={`${id}-agent`} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
          {agents.map((a) => <option key={a.id} value={a.id}>{agentLabel(a)}</option>)}
        </select>
      </div>
      <button type="submit" className="primary" disabled={tabId === undefined}>{conversation ? 'Continue' : 'Start'}</button>
      <button type="button" onClick={onClose}>Cancel</button>
    </form>
  );
}
