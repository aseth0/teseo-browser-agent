// "Layers": the chat with its layers under each bubble, 📤 what each request to the model sent and
// 📥 how it went. The
// history is append-only, so each request is the system prompt plus the history up to there.
// The background marked where its values come from (page or extension), so the requests can be
// colored like the prompt preview's; your own messages are marked here.
import { useMemo } from 'react';
import { buildSystemPrompt } from '../../context/request';
import { markValue, stripMarks, withMarkedValues } from '../../core/model-texts';
import type { ToolInfo } from '../../core/protocol';
import type { Message } from '../../core/types';
import { toOpenAITools } from '../../providers/wire';
import { callsOf, toCallViews, type Call, type CallOptions } from '../../ui/calls/calls';
import { CallSection } from '../../ui/calls/CallSection';
import { ChatWithCalls } from '../../ui/calls/ChatWithCalls';
import type { ToolResultPart } from '../../ui/ChatMessages';
import { requestAs, requestHead, toolGroupSizes, viewFor } from '../../ui/request-parts';
import { useTemplates } from '../../ui/templates/useTemplates';
import { useSkills } from '../../ui/Skills';
import { agentById, agentStore } from '../../agents/profiles';
import { useCollection } from '../../ui/useCollection';
import { memoryStore } from '../../memory/store';
import { useSettingsContext } from '../../ui/settings-context';
import { MANAGER_PANEL_ROW } from '../../ui/floating-frame';

interface Props {
  history: Message[];
  results: Map<string, ToolResultPart>;
  running: boolean;
  toolCatalog: ToolInfo[];
}

export function TechHistory({ history, results, running, toolCatalog }: Props) {
  const { settings } = useSettingsContext();
  const view = settings.chatView ?? {};
  const agents = useCollection(agentStore);
  const allSkills = useSkills();
  const allTemplates = useTemplates();
  const allMemory = useCollection(memoryStore);
  // Built again only when what they are built from changes, not on every render.
  const { calls, requestOf } = useMemo(() => {
    const markedCalls = withMarkedValues(() => callsOf(history.map(markTyped)));
    // Each call as the agent its message went to saw it (agents/profiles), like the background built
    // it; a message from before agents, or to one gone, as Default.
    const buildFor = (agentId: string | undefined) => {
      const agent = agentById(agents, agentId);
      const { settings: seen, skills, templates, offered, specs, asks, memory, heldSkills } = requestAs(agent, settings, { skills: allSkills, templates: allTemplates, catalog: toolCatalog, agents, memory: allMemory }, MANAGER_PANEL_ROW !== undefined, history);
      const system = withMarkedValues(() => buildSystemPrompt({ settings: seen, skills, templates, agent, asksAgents: asks, memory, heldSkills }));
      const view = viewFor(seen, offered);
      const opts: CallOptions = { system: stripMarks(system), specs, head: requestHead(settings, agent), view, marked: { system, calls: markedCalls } };
      return { opts, tools: toOpenAITools(specs), toolGroups: toolGroupSizes(offered) };
    };
    const requests = new Map<string | undefined, ReturnType<typeof buildFor>>();
    const requestOf = (call: Call) => {
      const agentId = call.history.findLast((m) => m.role === 'user')?.agent;
      if (!requests.has(agentId)) requests.set(agentId, buildFor(agentId));
      return requests.get(agentId)!;
    };
    return { calls: toCallViews(callsOf(history), (call) => requestOf(call).opts), requestOf };
  }, [history, settings, agents, allSkills, allTemplates, allMemory, toolCatalog]);
  return (
    <ChatWithCalls
      chat={history}
      calls={calls}
      results={results}
      running={running}
      open={view.techCallsOpen ?? false}
      section={(call, i, reported) => (
        <CallSection call={call} id={`chat.call${i + 1}`} inChat reported={reported} origin originOn={view.techOrigin ?? true}
          tools={requestOf(call).tools} toolGroups={requestOf(call).toolGroups} />
      )}
    />
  );
}

// What you typed (not the context the extension attached), marked as your message.
const markTyped = (m: Message): Message =>
  m.role === 'user' ? { ...m, parts: m.parts.map((p) => (p.type === 'text' && !p.context ? { ...p, text: markValue(p.text, 'message') } : p)) } : m;
