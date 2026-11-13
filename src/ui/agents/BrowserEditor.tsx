import { useState } from 'react';
import { DEFAULT_AGENT_ICON, DEFAULT_AGENT_NAME, DEFAULT_BROWSER_DESCRIPTION } from '../../agents/builtins';
import { skillStore } from '../../skills/store';
import { templateStore } from '../../templates/store';
import { BackToList, EditorFooter } from '../Collection';
import { IconPicker } from '../fields';
import { useTemplates } from '../templates/useTemplates';
import { useSkills } from '../Skills';
import { GoTo, PageSection } from '../text-pages';
import type { AgentsProps } from './AgentsSection';
import { AgentVoice } from './AgentVoice';
import { AskToggles, BrowserTools, GivenList, MemoryChoice, skillItems, templateItems } from './fields';

// Browser: the chat as always. Its icon, instructions, memory and "Can ask" are its own; its tools,
// skills and site templates are those switched on in Tools, Skills and Site templates, edited here
// too; its sites, those of Site policies. Its name stays.
export function BrowserEditor({ settings, onChange, onClose }: AgentsProps & { onClose: () => void }) {
  const skills = useSkills();
  const templates = useTemplates();
  const [draft, setDraft] = useState({ ...settings.browserAgent, canAsk: !!settings.defaultCanAsk });
  const [editedTools, setDisabledTools] = useState<string[]>(); // undefined: not edited here
  const disabledTools = editedTools ?? settings.disabledTools ?? [];
  const [givenSkills, setGivenSkills] = useState<string[] | null>(null); // null: as they are
  const [givenTemplates, setGivenTemplates] = useState<string[] | null>(null);
  const skillsOn = givenSkills ?? skills.filter((s) => s.enabled).map((s) => s.name).sort();
  const templatesOn = givenTemplates ?? templates.filter((t) => t.enabled).map((t) => t.name).sort();
  const patch = (change: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...change }));
  const save = async () => {
    const { canAsk, ...own } = draft;
    // The tools only when switched here: Settings → Tools may have changed them since this opened.
    const browserAgent = { ...own, description: own.description?.trim() || undefined, instructions: own.instructions?.trim() || undefined };
    onChange((s) => ({ ...s, browserAgent, defaultCanAsk: canAsk || undefined, ...(editedTools && { disabledTools: editedTools }) }));
    // Switched on or off in Skills and Site templates, only those changed here.
    await Promise.all([
      ...skills.filter((s) => s.enabled !== skillsOn.includes(s.name)).map((s) => skillStore.update(s.id, { enabled: !s.enabled })),
      ...templates.filter((t) => t.enabled !== templatesOn.includes(t.name)).map((t) => templateStore.update(t.id, { enabled: !t.enabled })),
    ]);
    onClose();
  };
  return (
    <section className="editor">
      <BackToList route="agents" title="Agents" />
      <h3>Edit {DEFAULT_AGENT_NAME}</h3>
      <div className="row">
        <div className="icon-field">
          <span>Icon</span>
          {/* None: no icon, kept as "" (unset is the 🌐 it comes with). */}
          <IconPicker icon={draft.icon ?? DEFAULT_AGENT_ICON} onChange={(icon) => patch({ icon: icon ?? '' })} />
        </div>
        <label>Name
          <input value={DEFAULT_AGENT_NAME} disabled title="Browser keeps its name" />
        </label>
      </div>
      <label>Description (what it is for: other agents read it to ask it)
        <input value={draft.description ?? ''} placeholder={DEFAULT_BROWSER_DESCRIPTION} onChange={(e) => patch({ description: e.target.value })} />
      </label>
      <label>Instructions (added after the system prompt)
        <textarea rows={6} value={draft.instructions ?? ''} placeholder="Answer in short paragraphs. Cite the page you read…" onChange={(e) => patch({ instructions: e.target.value })} />
      </label>
      <MemoryChoice name="browser-memory" memory={draft.memory} onChange={(memory) => patch({ memory })} />
      <BrowserTools disabled={disabledTools} onChange={setDisabledTools} />
      <GivenList page="skills" title="Skills" items={skillItems(skills)} given={skillsOn} none="No skills yet."
        onChange={setGivenSkills} />
      <GivenList page="site-templates" title="Site templates" items={templateItems(templates)} given={templatesOn} none="No site templates yet."
        onChange={setGivenTemplates} />
      <PageSection page="site-policies" title="Sites">
        <p className="hint">Browser uses every site with its policy in <GoTo hash="site-policies" title="Site policies" />.</p>
      </PageSection>
      <AgentVoice settings={settings} voice={{ voiceProfileId: draft.voiceProfileId, canSpeak: draft.canSpeak }} onChange={patch} />
      <AskToggles canAsk={draft.canAsk} canBeAsked={!!draft.canBeAsked}
        onCanAsk={(canAsk) => patch({ canAsk })} onCanBeAsked={(on) => patch({ canBeAsked: on || undefined })} />
      <EditorFooter problems={[]} isNew={false} onSave={save} onClose={onClose} />
    </section>
  );
}
