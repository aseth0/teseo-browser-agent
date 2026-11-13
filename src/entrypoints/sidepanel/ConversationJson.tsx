// The conversation exactly as the next request would send it: OpenAI messages, with the system
// prompt and the hidden context (page blocks, site skills), without the model's reasoning.
import { buildSystemPrompt } from '../../context/request';
import type { Message } from '../../core/types';
import { modelView } from '../../context/compaction';
import { toOpenAIMessages } from '../../providers/wire';
import { CopyIconButton } from '../../ui/icons';
import { useRequestAs } from '../../ui/useRequestAs';
import { useActiveAgent } from './AgentPicker';
import { useSettingsContext } from '../../ui/settings-context';

export function ConversationJson({ history }: { history: Message[] }) {
  const { settings } = useSettingsContext();
  const { agent } = useActiveAgent(settings);
  const { settings: seen, skills, templates, asks, memory, heldSkills } = useRequestAs(agent, settings, history);
  const view = modelView(buildSystemPrompt({ settings: seen, skills, templates, agent, asksAgents: asks, memory, heldSkills }), history);
  const messages = toOpenAIMessages(view.system, view.messages);
  const json = JSON.stringify(messages, null, 2);
  return (
    <details className="chat-json" open>
      <summary>
        <span title="The messages the next request carries, as the model receives them (tool definitions not shown)">Sent to the model</span>
        <span className="muted">{messages.length} messages</span>
        <span className="spacer" />
        <CopyIconButton text={json} label="Copy the JSON" />
      </summary>
      <pre>{json}</pre>
    </details>
  );
}
