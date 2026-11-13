// Every fixed text sent to the model, editable ("Templates"), the request they produce with
// example data ("Preview single call") and how requests grow ("Preview conversation"). Built with
// the same functions the background uses, so it cannot drift from the real requests.
import { useState } from 'react';
import { agentById, agentLabel, agentStore, browserAgentLabel, orderedAgentIds } from '../agents/profiles';
import { DEFAULT_AGENT_ID, EMPTY_AGENT } from '../agents/builtins';
import { InlineConfirm } from './InlineConfirm';
import type { Settings } from '../storage/settings';
import { DEFAULT_SYSTEM_PROMPT } from '../storage/settings-types';
import { ConversationPreview } from './ConversationPreview';
import { EditableText } from './EditableText';
import { HideToModelMarks } from './ToModel';
import { usePreviewData } from './preview-data';
import { useCollection } from './useCollection';
import type { SettingsPatch } from './useSettings';
import { Segmented } from './Segmented';
import { Templates } from './PromptTemplates';
import { Example } from './PromptExample';

type Mode = 'templates' | 'example' | 'conversation';

// Everything here reaches the model: no "model" marks.
export const PromptPreview = (props: { settings: Settings; onChange: SettingsPatch }) => (
  <HideToModelMarks>
    <PromptPreviewSection {...props} />
  </HideToModelMarks>
);

function PromptPreviewSection({ settings, onChange }: { settings: Settings; onChange: SettingsPatch }) {
  const [mode, setMode] = useState<Mode>('templates');
  // The previews as an agent sees them (Settings → Agents), or as Browser.
  const agents = useCollection(agentStore).filter((a) => a.enabled);
  const [agentId, setAgentId] = useState(DEFAULT_AGENT_ID);
  const agent = agentById(agents, agentId);
  const data = usePreviewData(); // shared by both previews, so a loaded page stays
  const modified = Object.keys(settings.promptTexts ?? {}).length;

  return (
    <section className="prompt-preview">
      <h3>Prompt preview</h3>
      <p className="hint">
        Every fixed text the model receives. Edit them in <strong>Templates</strong> (the tools' texts, in{' '}
        <a href="#tools">Tools</a>);{' '}
        <span className="placeholder">{'{placeholders}'}</span> are filled on each turn. <strong>Preview single call</strong> shows the
        resulting request with example data, and <strong>Preview conversation</strong> how the requests grow over a few turns.
      </p>
      <EditableText label="Your system prompt" note="At the start of the system message, on every request." defaultText={DEFAULT_SYSTEM_PROMPT}
        value={settings.systemPrompt !== DEFAULT_SYSTEM_PROMPT ? settings.systemPrompt : undefined}
        onSave={(v) => onChange({ systemPrompt: v ?? DEFAULT_SYSTEM_PROMPT })} />
      <div className="row">
        <Segmented label="Prompt preview" value={mode} onChange={setMode} options={[
          { value: 'templates', label: 'Templates' },
          { value: 'example', label: 'Preview single call' },
          { value: 'conversation', label: 'Preview conversation' },
        ]} />
        {agents.length > 0 && (
          <label className="check">As
            <select aria-label="Preview as agent" value={agent?.id ?? DEFAULT_AGENT_ID} onChange={(e) => setAgentId(e.target.value)}>
              {orderedAgentIds(agents, settings.agentOrder).map((id) => (
                <option key={id} value={id}>{id === DEFAULT_AGENT_ID ? browserAgentLabel(settings) : agentLabel(id === EMPTY_AGENT.id ? EMPTY_AGENT : agents.find((a) => a.id === id)!)}</option>
              ))}
            </select>
          </label>
        )}
        {modified > 0 && (
          <>
            <span className="muted">{modified} modified</span>
            <InlineConfirm question="Restore every text to its default?" action="Restore all" onConfirm={() => onChange({ promptTexts: {} })}>
              {(ask) => <button onClick={ask}>Restore all</button>}
            </InlineConfirm>
          </>
        )}
      </div>
      {mode === 'templates' && <Templates settings={settings} agent={agent} />}
      {mode === 'example' && <Example settings={settings} data={data} agent={agent} />}
      {mode === 'conversation' && <ConversationPreview settings={settings} data={data} agent={agent} />}
    </section>
  );
}
