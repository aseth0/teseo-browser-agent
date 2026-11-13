import { useState } from 'react';
import { BUILDER_ID } from '../../core/builder-ids';
import { agentProblems, agentStore, withSite, type AgentProfile } from '../../agents/profiles';
import { BackToList, EditorFooter } from '../Collection';
import { IconName, ProviderModel } from '../fields';
import { useTemplates } from '../templates/useTemplates';
import { useSkills } from '../Skills';
import type { AgentsProps } from './AgentsSection';
import { AgentVoice } from './AgentVoice';
import { AgentSites, AgentTools, AskToggles, GivenList, MemoryChoice, skillItems, templateItems } from './fields';

// An agent of yours: its icon, name and model, instructions, memory, tools, skills, templates, voice and sites.
export function AgentEditor({ settings, agent, agents, onClose }: AgentsProps & { agent: AgentProfile; agents: AgentProfile[]; onClose: () => void }) {
  const [draft, setDraft] = useState(agent);
  const skills = useSkills();
  const templates = useTemplates();
  const patch = (change: Partial<AgentProfile>) => setDraft((d) => ({ ...d, ...change }));
  const isNew = !agents.some((a) => a.id === agent.id);
  const current = { ...draft, name: draft.name.trim(), model: draft.model?.trim() || undefined };
  const problems = agentProblems(current, agents);
  return (
    <section className="editor">
      <BackToList route="agents" title="Agents" />
      <h3>{isNew ? 'New agent' : `Edit ${agent.name}`}</h3>
      <IconName icon={draft.icon} name={draft.name} nameLabel="Name" namePlaceholder="jira" onChange={patch}>
        <ProviderModel providers={settings.providers} providerId={draft.providerId} model={draft.model} none="The chat's model" onChange={patch} />
      </IconName>
      <label>Description (what it is for)
        <input value={draft.description} placeholder="Works with Jira tickets: searches, reads and comments" onChange={(e) => patch({ description: e.target.value })} />
      </label>
      <label>Instructions (added after the system prompt)
        <textarea rows={6} value={draft.instructions} placeholder="You work with the team's Jira. Ticket keys look like PROJ-123…" onChange={(e) => patch({ instructions: e.target.value })} />
      </label>
      <MemoryChoice name="agent-memory" memory={draft.memory} onChange={(memory) => patch({ memory })} />
      <AgentTools tools={draft.tools} onChange={(tools) => patch({ tools })} />
      <GivenList page="skills" title="Skills" items={skillItems(skills)} given={draft.skills} none="No skills yet."
        onChange={(given) => patch({ skills: given })} />
      {/* Their data reaches it only on its own sites, with the page. */}
      <GivenList page="site-templates" title="Site templates" items={templateItems(templates)} given={draft.templates} none="No site templates yet."
        onChange={(given) => patch({ templates: given })} />
      <AgentVoice settings={settings} voice={{ voiceProfileId: draft.voiceProfileId, canSpeak: draft.canSpeak }} onChange={patch} />
      <AskToggles canAsk={draft.canAsk} canBeAsked={draft.canBeAsked}
        onCanAsk={(canAsk) => patch({ canAsk })} onCanBeAsked={(canBeAsked) => patch({ canBeAsked })} />
      <AgentSites sites={draft.sites} only={!!draft.onlyItsSites} onOnly={(only) => patch({ onlyItsSites: only || undefined })}
        onChange={(host, policy) => setDraft((d) => withSite(d, host, policy))} />
      <EditorFooter problems={problems} isNew={isNew}
        onSave={async () => { await agentStore.save(current); onClose(); }} onDelete={agent.id === BUILDER_ID ? undefined : () => agentStore.remove(agent.id)} onClose={onClose} />
    </section>
  );
}
