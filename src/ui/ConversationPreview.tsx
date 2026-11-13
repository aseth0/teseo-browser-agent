// "Preview conversation": a short simulated conversation built with the same functions as the
// real one. Every call resends the whole history; each call shows which messages are new.
import { useMemo, useState } from 'react';
import { buildSystemPrompt } from '../context/request';
import { estimateRequest, estimateSources } from '../context/usage';
import { appendContext } from '../core/messages';
import { stripMarks, withMarkedValues } from '../core/model-texts';
import type { CallUsage, Message, MessageMeta } from '../core/types';
import { toOpenAITools } from '../providers/wire';
import { siteContextItems } from '../context/site-context';
import type { Skill } from '../skills/types';
import type { PageTemplate } from '../templates/types';
import type { Settings } from '../storage/settings';
import type { AgentProfile } from '../agents/profiles';
import type { MemoryPromptOptions } from '../memory/prompt';
import type { MeaningMatch } from '../memory/items';
import { memoryFor, type MemoryItem } from '../memory/store';
import { toCallViews, type Call, type CallView } from './calls/calls';
import { CallSection } from './calls/CallSection';
import { ChatWithCalls } from './calls/ChatWithCalls';
import { toolResultsById } from './ChatMessages';
import { usePreviewMeaning } from './usePreviewMeaning';
import { clickReply, markedPage, PreviewInputs, previewPageItems, typedMessage, usePreviewData, type PreviewData } from './preview-data';
import { requestAs, requestHead, toolGroupSizes, tokensLabel, viewFor } from './request-parts';
import { SAMPLE_REPLY, SAMPLE_REPLY_2 } from './sample-page';
import { useRequestSources } from './useRequestAs';
import { Segmented } from './Segmented';

interface Conversation {
  calls: Call[];
  chat: Message[]; // the whole conversation, as the side panel shows it
}

// The ref the simulated click uses: the first button of the page, else the first ref.
const clickTarget = (snapshot: string) =>
  snapshot.match(/button "[^"]*" \[(ref_\w+)\]/)?.[1] ?? snapshot.match(/\[(ref_\w+)\]/)?.[1] ?? 'ref_1';

// Invented tokens and times of the sample's model calls, for the stats under the answers.
const sampleMeta = (call: number): MessageMeta =>
  [
    { input: 2410, output: 38, reported: true, ms: 1900, firstTokenMs: 850, sinceStartMs: 2300 },
    { input: 2630, output: 54, reported: true, ms: 1400, firstTokenMs: 600, sinceStartMs: 4100 },
    { input: 3120, output: 61, reported: true, ms: 1600, firstTokenMs: 700, sinceStartMs: 2000 },
  ][call]!;

// Three calls of a conversation, as the background would build them. Inside withMarkedValues the
// values come out marked for the origin colors; outside, clean.
function buildConversation(data: PreviewData, settings: Settings, skills: Skill[], templates: PageTemplate[], memory: MemoryItem[], memoryOpts: MemoryPromptOptions | undefined, meaningOf: ReadonlyMap<string, MeaningMatch>): Conversation {
  const { page } = data;
  const fromPage = markedPage(page);
  // What goes for the site and each message, as the background builds it (context/turn).
  const forSite = (typed: string, history: Message[]) => siteContextItems({ settings, skills, templates, memory, memoryOpts, url: page.url, typed, history, meaning: meaningOf.get(typed) });
  const fromPageItems = previewPageItems(forSite('', []), data, fromPage); // read again on every message

  const first = appendContext([typedMessage(data.message)], [...forSite(data.message, []).items, ...fromPageItems]);
  const toolCall: Message = {
    role: 'assistant',
    parts: [
      { type: 'reasoning', text: 'The user wants something on this page: click the button…' },
      { type: 'tool_call', id: 'call_1', name: 'browser__click', args: { ref: clickTarget(page.snapshot) } },
    ],
    meta: sampleMeta(0),
  };
  const toolResult: Message = {
    role: 'tool',
    parts: [{ type: 'tool_result', toolCallId: 'call_1', content: clickReply(page) }],
  };
  const reply: Message = { role: 'assistant', parts: [{ type: 'text', text: SAMPLE_REPLY }], meta: sampleMeta(1) };
  const turn1 = [...first, toolCall, toolResult, reply];
  const second = appendContext([...turn1, typedMessage(data.followUp)], [...forSite(data.followUp, turn1).items, ...fromPageItems]);
  const lastReply: Message = { role: 'assistant', parts: [{ type: 'text', text: SAMPLE_REPLY_2 }], meta: sampleMeta(2) };

  const calls: Call[] = [
    {
      title: 'Call 1 · your first message',
      why: 'You send a message: it goes with the page block (and any site skill in full).',
      history: first,
      at: 1,
    },
    {
      title: 'Call 2 · after the tool runs',
      why: 'The model asked for browser__click. The extension ran it and calls again with the same messages plus the tool request and its result. The model\'s reasoning is shown in the chat but not sent.',
      history: [...first, toolCall, toolResult],
      at: 3,
    },
    {
      title: 'Call 3 · your second message',
      why: 'The model answered with text, ending the first turn. Your next message resends everything before it unchanged, with a fresh page block (and a one-line reminder of a site skill).',
      history: second,
      at: 5,
    },
  ];
  return { calls, chat: [...second, lastReply] };
}

type View = 'chat' | 'calls';

// The simulated conversation and its requests, as the background would build them.
// With an agent (Settings → Agents), as that agent sees it.
function useSampleConversation(base: Settings, data: PreviewData, agent?: AgentProfile) {
  const { skills: allSkills, templates: allTemplates, catalog, agents, memory: allMemory } = useRequestSources();
  // Not on every render: the side panel's preview re-renders on every key typed in its box.
  const { page, message, followUp, values, results: runs } = data;
  const meaningOf = usePreviewMeaning(base, [message, followUp], memoryFor(allMemory, agent?.id));
  return useMemo(() => {
    const { settings, skills, templates, offered, specs, asks, memory, memoryOpts, heldSkills } = requestAs(agent, base, { skills: allSkills, templates: allTemplates, catalog, agents, memory: allMemory });
    const tools = toOpenAITools(specs);
    // Built twice: marked for the origin colors, clean for what the requests carry.
    const shown = withMarkedValues(() => ({ system: buildSystemPrompt({ settings, skills, templates, agent, asksAgents: asks, memory, heldSkills }), ...buildConversation(data, settings, skills, templates, memory, memoryOpts, meaningOf) }));
    const system = buildSystemPrompt({ settings, skills, templates, agent, asksAgents: asks, memory, heldSkills });
    const conversation = buildConversation(data, settings, skills, templates, memory, memoryOpts, meaningOf);
    const view = viewFor(settings, offered);
    const calls = toCallViews(conversation.calls, { system, specs, head: requestHead(base, agent), view, marked: shown });
    // How full the context is after the last call, as the panel's meter shows it.
    const last = view(system, conversation.calls.at(-1)!.history);
    const lastShown = view(shown.system, shown.calls.at(-1)!.history);
    const lastUsage: CallUsage = {
      breakdown: estimateRequest(last.system, specs, last.messages),
      sources: estimateSources(lastShown.system, specs, lastShown.messages),
      estimatedOutput: 30,
    };
    return { calls, chat: conversation.chat, markedChat: shown.chat, results: toolResultsById(conversation.chat), tools, toolGroups: toolGroupSizes(offered), lastUsage };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- by data's fields: the preview passes a new data object on every render
  }, [base, agent, agents, allSkills, allTemplates, allMemory, catalog, page, message, followUp, values, runs, meaningOf]);
}

// The sample conversation on the invented page, for the side panel's preview mode: with the origin
// marks, as the background keeps them, except on what you typed (the panel marks that itself).
export function useSampleChat(settings: Settings) {
  const { markedChat, lastUsage } = useSampleConversation(settings, usePreviewData());
  const history = useMemo(
    () => markedChat.map((m): Message => (m.role === 'user' ? { ...m, parts: m.parts.map((p) => (p.type === 'text' && !p.context ? { ...p, text: stripMarks(p.text) } : p)) } : m)),
    [markedChat],
  );
  return { history, lastUsage };
}

export function ConversationPreview({ settings, data, agent }: { settings: Settings; data: PreviewData; agent?: AgentProfile }) {
  const [view, setView] = useState<View>('chat');
  const { calls, chat, results, tools, toolGroups } = useSampleConversation(settings, data, agent);
  const max = Math.max(...calls.map((c) => c.total));

  const callSection = (call: CallView, i: number, inChat: boolean, reported?: number) => (
    <CallSection key={call.title} call={call} id={`conversation.${inChat ? 'chat' : 'call'}${i + 1}`} inChat={inChat} reported={reported} origin tools={tools} toolGroups={toolGroups} viewsInTitle />
  );

  return (
    <>
      <div className="prompt-example-inputs">
        <PreviewInputs data={data} followUp />
      </div>

      <div className="conv-growth" aria-label="Tokens sent per call">
        {calls.map((c, i) => (
          <div key={c.title} className="conv-growth-row">
            <span>Call {i + 1}</span>
            <span className="conv-bar"><span style={{ width: `${(c.total / max) * 100}%` }} /></span>
            <span className="muted">{tokensLabel(c.total)}{i > 0 && ` (+${(c.total - calls[i - 1]!.total).toLocaleString('en-US')})`}</span>
          </div>
        ))}
      </div>

      <Segmented className="small" label="Conversation view" value={view} onChange={setView} options={[{ value: 'chat', label: 'As chat' }, { value: 'calls', label: 'As calls' }]} />

      {view === 'chat' ? (
        <>
          <p className="hint">The conversation as the side panel shows it. The layers button at the end of a message's line shows what came back from its call (📥) and the request it sent (📤).</p>
          <div className="messages chat-preview">
            <ChatWithCalls chat={chat} calls={calls} results={results} running={false} section={(c, i, reported) => callSection(c, i, true, reported)} />
          </div>
        </>
      ) : (
        calls.map((call, i) => callSection(call, i, false))
      )}
    </>
  );
}

