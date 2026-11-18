import { AutoInjectMenu } from './AutoInjectMenu';
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import type { TurnDiagramKind } from '../../storage/settings-types';
import { createPortal } from 'react-dom';
import { MAKE_TOOL_MESSAGE, type Recording } from '../../recording/recording';
import { ChatActionsContext, LiveContext, RecalledContext, SubRunsContext, toolResultsById, turnCuts } from '../../ui/ChatMessages';
import { McpButton, ToolsButton } from '../../ui/Tools';
import { IconButton, JSON_ICON, PAGE_ICON } from '../../ui/icons';
import { Icon } from '../../ui/chat-icons';
import { OverflowBar } from '../../ui/OverflowBar';
import { openOptions } from '../../ui/open-options';
import { agentOffers, agentStore } from '../../agents/profiles';
import { BUILDER_ID } from '../../core/builder-ids';
import { onDemandGroups, onDemandNames } from '../../tools/load';
import { heldFor } from '../../tools/match';
import { hasCreateGroup } from '../../agents/builtins';
import { AgentPicker } from './AgentPicker';
import { AttachButtons, AttachmentStrip } from './Attachments';
import { ConfirmationCards } from './ConfirmCards';
import { ContextMeter } from './ContextMeter';
import { ConversationJsonView, HistoryView } from './HistoryView';
import type { ComposerHandle } from './MentionComposer';
import { MentionsHelp } from './MentionsHelp';
import { ModelPicker, useContextWindow } from './ModelPicker';
import { PageBar } from './PageBar';
import { BlacklistChip, useWordBlacklist } from './BlacklistChip';
import { chatBlacklistState, wentMasked } from '../../word-blacklist/gate';
import { maskedItems, ReplacedContext } from '../../ui/chat/replaced';
import { RecordingReview } from './RecordingReview';
import { RecordingChip } from './RecordingChip';
import { DevtoolsChip } from './DevtoolsChip';
import { ChatStatusLines } from './ChatStatusLines';
import { ComposerArea } from './ComposerArea';
import { DictateButton, DictationLines } from './Dictation';
import { useDictation } from './useDictation';
import { useStableCallback } from '../../ui/useStableCallback';
import { QueuedStrip } from './QueuedStrip';
import { useSendPipeline } from './useSendPipeline';
import { renderOf, RenderSelector } from './RenderSelector';
import { useAgentTools } from './useAgentTools';
import { useCompaction } from './useCompaction';
import { useAttachments } from './useAttachments';
import { isAudioPayload, type AudioPayload } from '../../audio/protocol';
import { CHAT_ATTACH, isImagesPayload, type ImagesPayload } from '../../capture/protocol';
import { HANDOFF_MS } from '../../core/handoff';
import { useHandoff } from './useHandoff';

// What the popup, a shortcut or the background hands to the message box: images, or a tab's audio.
const isAttachPayload = (p: unknown): p is ImagesPayload | AudioPayload => isImagesPayload(p) || isAudioPayload(p);
import { useRecording } from './useRecording';
import { useFollowScroll } from './useFollowScroll';
import { withMakeTool } from './make-tool';
import { SelectionChip } from './SelectionChip';
import { useSpeakButtons } from './useSpeakButtons';
import { useAutoRead } from './useAutoRead';
import { TemplateChips } from './TemplateChips';
import { ThinkingSelector } from './ThinkingSelector';
import type { Agent } from './useAgent';
import { PlanView } from './UserCards';
import { LiveStream } from './LiveStream';
import type { PageTarget } from './usePageTarget';
import { useSettingsContext } from '../../ui/settings-context';
import { latestPlan, planShown } from '../../tools/user/shapes';
import { useAutoInjectSkip } from './useAutoInjectSkip';
import { useRecallState } from './composer/useRecallState';
import { usePageSelection } from './usePageSelection';
import { useChatTarget } from './manager-chat';
import type { RunGate } from './useSendPipeline';

const NO_TOOLS_OFF: string[] = [];

interface Props {
  agent: Agent; // the conversation (useAgent, or a preview)
  page: PageTarget; // the page the agent works on
  queued?: QueuedMessage; // a message to send as soon as its agent is the one chosen
  onOpenMemory?: () => void; // the memory panel (a message's memory chip)
  topbar?: HTMLElement | null; // where the DevTools chip goes (none in a preview)
  autoInjectTo?: HTMLElement | null; // where the auto-inject menu goes: the top bar, joined to memory, history and bookmarks
  voice?: boolean; // the message box's 🎤 (modes ChatChrome)
  runGate?: RunGate; // floating on a page: what lets a run of the pinned conversation go (useSendPipeline)
}

// A message the page widget sends (an action that opens the chat), in a new conversation.
export interface QueuedMessage {
  at: number; // which one: each is sent once
  text: string;
  shown?: string; // how the chat shows it (Part shown)
  agentId?: string; // none: Default
}

export function Chat({ agent, page, queued, onOpenMemory, topbar, autoInjectTo, voice, runGate }: Props) {
  const { settings, update: onChange } = useSettingsContext();
  const { history, live, busy, usage, reset } = agent;
  const [input, setInput] = useState('');
  // A recording of the page's requests (started from the toolbar popup), reviewed, then attached to the next message.
  const recorder = useRecording();
  const [recording, setRecording] = useState<Recording>();
  const composer = useRef<ComposerHandle>(null);
  const results = useMemo(() => toolResultsById(history), [history]);

  // `own`: in the agent manager, the chat's own model, once chosen.
  const { agents, profile, own, provider, model } = useChatTarget(settings);
  const { toolCatalog, pageToolNames, menuTools, toolSettings, onToolSettings } = useAgentTools(settings, onChange, page, profile, agents, history.length ? undefined : agent.conversationId);
  const contextWindow = useContextWindow(settings, onChange, provider, model);
  const compaction = useCompaction(agent, settings, contextWindow.window, { provider, model });
  const attachments = useAttachments();
  // A screenshot from the popup or a shortcut, or a tab's audio transcribed, into the message box.
  useHandoff(CHAT_ATTACH, isAttachPayload, { waitMs: HANDOFF_MS, tag: 'capture-handoff' }, ({ payload: a }) => {
    if (a.kind === 'audio') attachments.addAudio(a);
    else attachments.addImages(a.images, a.note);
  });
  const { includePage, pageWithheld, selection, noSelection, setSkippedSelection } = usePageSelection(settings, page, profile, history.length);
  const render = renderOf(settings.chatRender);
  const format = render === 'tech' || render === 'diagrams' ? 'markdown' : render;
  const [showJson, setShowJson] = useState(false);
  // Your messages, for ↑ ↓ in the composer; the one shown there is marked in the conversation.
  const { promptTexts, recall, setRecall, recalled } = useRecallState(history, agent.conversationId);
  const cuts = useMemo(() => turnCuts(history), [history]);
  const plan = useMemo(() => latestPlan(history), [history]);
  const { skip, setSkip, offWhy } = useAutoInjectSkip(settings, agent.conversationId);
  // The word blacklist, as the next request would go; turned on or off by hand for one conversation (by
  // its id), until the panel is opened again.
  const wordBlacklist = useWordBlacklist();
  const [blacklistChosen, setBlacklistChosen] = useState<{ conversationId: string; choice: 'on' | 'off' }>();
  const blacklistChoice = blacklistChosen?.conversationId === agent.conversationId ? blacklistChosen.choice : undefined;
  const blacklistState = chatBlacklistState({ config: wordBlacklist.config, hasTerms: !!wordBlacklist.blacklist, providerId: provider?.id ?? '', model, history, pageUrl: page.url, chosen: blacklistChoice });
  const sentMasked = wentMasked(history);
  const replaced = useMemo(() => ({ blacklist: wordBlacklist.blacklist, masked: maskedItems(history) }), [wordBlacklist.blacklist, history]);
  // Before the return without a provider, as every hook: adding or removing the last provider must
  // not change their number.
  const { sendNow, sendInsteadNow, canSend, sendError, regenerateLatest, continueRun, stopRun, waiting } = useSendPipeline({
    agent, page, queued, runGate, provider, model, profile, includePage, noSelection, skip, blacklistChoice, input, setInput, attachments, recording, compaction,
    onSent: () => {
      setRecording(undefined);
      setSkippedSelection(undefined);
    },
  });
  // Sending while dictating stops it, and sends (or queues) once the last chunk's text is in the box.
  const dictation = useDictation({ composer, setInput, conversationId: agent.conversationId });
  const afterDictation = useRef<() => void>(undefined);
  const whenDictated = (action: () => void) => {
    if (dictation.state === 'idle') return action();
    afterDictation.current = action;
    dictation.stop();
  };
  useEffect(() => {
    const action = afterDictation.current;
    if (dictation.state !== 'idle' || !action) return;
    afterDictation.current = undefined;
    action();
  }, [dictation.state]);
  const sendBoxNow = useStableCallback(() => whenDictated(sendNow));
  const sendBoxInstead = useStableCallback(() => whenDictated(() => sendInsteadNow()));
  const pickDiagram = useCallback((turnDiagram: TurnDiagramKind) => onChange((s) => ({ ...s, chatView: { ...s.chatView, turnDiagram } })), [onChange]);
  const speak = useSpeakButtons(settings, agents, page.tabId);
  useAutoRead(live, history, busy, agent.conversationId, settings, speak);
  const actions = useMemo(() => ({ busy, regenerate: regenerateLatest, openMemory: onOpenMemory, pickDiagram, speak }), [busy, regenerateLatest, onOpenMemory, pickDiagram, speak]);

  const followAlways = (settings.chatView?.autoScroll ?? 'always') === 'always';
  const below = `${agent.confirmations.length}|${agent.stepLimit ?? ''}|${agent.error ?? ''}|${sendError}`;
  const { listRef, onScroll, follow } = useFollowScroll(history, followAlways, recalled, below);

  // The message box and the page bar are memoized (they re-render as you type, or with the page):
  // their props are the same while what they show is.
  // The tools offered once the model loads them, until this conversation does (tools/load): Default's
  // that create things (none while Builder has them: not in its menus), those of the servers set so, and
  // the groups your last message did not match (Settings → Tools → Matching, tools/match).
  const onDemand = useMemo(
    () => {
      const groups = onDemandGroups(settings, menuTools, { create: hasCreateGroup(profile) });
      return onDemandNames([...groups, ...heldFor(history, menuTools, groups)], history);
    },
    [settings, menuTools, profile, history],
  );
  const composerTools = useMemo(() => agentOffers(profile, toolCatalog, agents), [profile, toolCatalog, agents]);
  const skillsOff = offWhy('siteSkills');
  const templatesWithheld = offWhy('templates') ?? pageWithheld;
  const pageBar = useMemo(() => (
    <PageBar page={page} pageTools={pageToolNames} conversationId={agent.conversationId} profile={profile} skillsOff={skillsOff}
      templates={<TemplateChips page={page} profile={profile} refresh={history.length} withheld={templatesWithheld} />}
      blacklist={<BlacklistChip state={blacklistState} sentMasked={sentMasked} onChoose={(choice) => setBlacklistChosen({ conversationId: agent.conversationId, choice })} />}
      selection={selection && <SelectionChip selection={selection} off={noSelection} onToggle={() => setSkippedSelection(noSelection ? undefined : selection.text)} speak={speak} agentId={profile?.id} />}>
      <IconButton label={`Attach the active page to each message: ${includePage ? 'on' : 'off'}`} icon={PAGE_ICON}
        pressed={includePage} onClick={() => onChange({ includePage: !includePage })} />
      <RenderSelector render={render} onSelect={(chatRender) => onChange({ chatRender })} />
      <IconButton label="Show the conversation as sent to the model (JSON)" icon={JSON_ICON}
        pressed={showJson} onClick={() => setShowJson((v) => !v)} />
    </PageBar>
  ), [page, pageToolNames, agent.conversationId, profile, skillsOff, blacklistState, sentMasked, history.length, templatesWithheld, selection, noSelection, setSkippedSelection, speak, includePage, onChange, render, showJson]);

  if (!provider)
    return (
      <div className="empty">
        <p>Add an OpenAI-compatible provider to start chatting.</p>
        <button onClick={() => void openOptions()}>Open settings</button>
      </div>
    );

  // The reviewed recording goes with the next message, and leaves the review. One already attached
  // stays: the new one stays in the review, and the composer says why.
  const attach = (tool: boolean) => {
    if (recording) {
      attachments.say('A recording is already attached to this message: remove it to attach another.');
      return false;
    }
    setRecording(recorder.recording && { ...recorder.recording, tool });
    recorder.discard();
    return true;
  };
  const attachRecording = () => attach(false);
  // Make a tool…: the recording attached with its variables, a message asking for the tool in the box
  // (yours to send or change), and the chat with Builder when it is on (only it saves tools then).
  const attachForTool = () => attach(true);
  const makeTool = () => {
    if (!attachForTool()) return;
    setInput(withMakeTool(input, MAKE_TOOL_MESSAGE));
    if (agents.some((a) => a.id === BUILDER_ID) && profile?.id !== BUILDER_ID) onChange({ activeAgentId: BUILDER_ID });
    requestAnimationFrame(() => composer.current?.focusEnd());
  };
  // A mention picked from the empty chat's list goes at the end of the message, caret after it.
  const insertMention = (token: string) => {
    const next = `${input}${input && !/\s$/.test(input) ? ' ' : ''}${token}`;
    setInput(next);
    requestAnimationFrame(() => composer.current?.focusEnd());
  };

  return (
    // The text size (Settings → Appearance) scales the messages and the message box.
    <div className="chat" style={{ '--chat-zoom': (settings.chatView?.textSize ?? 100) / 100 } as CSSProperties}>
      {showJson && <ConversationJsonView history={history} />}
      {recorder.recording && (
        <RecordingReview recording={recorder.recording} anotherWaits={recorder.anotherWaits} onChange={recorder.setRecording} onDiscard={recorder.discard}
          onAttach={attachRecording} onMakeTool={makeTool} />
      )}
      <div className="messages" ref={listRef} onScroll={onScroll}>
        <ChatActionsContext.Provider value={actions}>
          <RecalledContext.Provider value={recalled}>
          <SubRunsContext.Provider value={agent.subs}>
          <LiveContext.Provider value={live}>
          <ReplacedContext.Provider value={replaced}>
          {/* Its own per turn state (the diagram kind, what is unfolded) for each conversation. */}
          <HistoryView key={agent.conversationId} render={render} history={history} results={results} running={busy} toolCatalog={toolCatalog} />
          {!history.length && !busy && (
            <MentionsHelp tools={toolCatalog} disabledTools={settings.disabledTools ?? []} mentions={settings.mentions} onInsert={insertMention} />
          )}
          </ReplacedContext.Provider>
          </LiveContext.Provider>
          </SubRunsContext.Provider>
          </RecalledContext.Provider>
        </ChatActionsContext.Provider>
        <LiveStream live={live} format={format} onShown={follow} />
        <ConfirmationCards agent={agent} />
        <ChatStatusLines agent={agent} results={results} compacting={compaction.status} sendError={sendError} onContinue={continueRun} allPhases={render === 'tech'} />
      </div>

      {plan && planShown(plan, history, { busy }) && <PlanView steps={plan.steps} onDismiss={() => agent.dismissPlan(plan.id)} />}
      {pageBar}
      {autoInjectTo && createPortal(
        <AutoInjectMenu url={page.url} skip={skip} onSkip={setSkip} />,
        autoInjectTo,
      )}
      <AttachmentStrip attachments={attachments} />
      <DevtoolsChip topbar={topbar} />
      {recording && <RecordingChip recording={recording} onRemove={() => setRecording(undefined)} onReview={() => { recorder.review(recording); setRecording(undefined); }} />}
      <QueuedStrip items={waiting.items} canEdit={!input.trim()} onEdit={waiting.edit} onSendNow={sendInsteadNow} onRemove={waiting.remove} />
      <ComposerArea composer={composer} attachments={attachments} busy={busy} compacting={compaction.compacting} dictation={dictation} onSend={sendBoxNow} onStop={stopRun}
        canSend={canSend && !runGate?.off}
        box={{
          value: input, onChange: setInput, onSend: sendBoxNow, onSendNow: sendBoxInstead, prompts: promptTexts, tools: composerTools, disabledTools: profile ? NO_TOOLS_OFF : settings.disabledTools,
          mentions: settings.mentions, bookmarksRoot: settings.bookmarks?.rootId, conversationId: agent.conversationId, recall, onRecall: setRecall,
        }} />
      <DictationLines dictation={dictation} />
      {/* The model stays; narrower, the others go behind ⋯ from the left. */}
      <OverflowBar className="composer-actions" label="message box buttons" hideFrom="start" trayAbove
        items={[
          { key: 'new', node: <button className="icon-button" onClick={reset} disabled={busy || compaction.compacting} title="New conversation" aria-label="New conversation"><Icon name="newChat" size={16} /></button> },
          { key: 'attach', node: <AttachButtons attachments={attachments} tabId={page.tabId} /> },
          ...(voice ? [{ key: 'voice', node: <DictateButton dictation={dictation} /> }] : []),
          { key: 'tools', node: <ToolsButton tools={menuTools} settings={toolSettings} onChange={onToolSettings} onDemand={onDemand} /> },
          { key: 'mcp', node: <McpButton tools={menuTools} settings={toolSettings} onChange={onToolSettings} onDemand={onDemand} /> },
          { key: 'context', push: true, node: (
            <ContextMeter usage={usage} window={contextWindow.window} model={model} cuts={cuts} catalog={toolCatalog} ratio={compaction.ratio} assumed={contextWindow.window.tokens ? undefined : compaction.autoWindow} onSetWindow={contextWindow.set}
              compaction={{ busy: compaction.compacting, note: compaction.note, onCompact: busy ? undefined : compaction.compactNow, wouldFree: compaction.wouldFree }} />
          ) },
          { key: 'thinking', node: <ThinkingSelector provider={provider} model={model} /> },
          { key: 'agent', node: <AgentPicker agents={agents} agent={profile} disabled={busy || compaction.compacting} /> },
        ]}
        tail={
          /* With an agent, the model chosen is the agent's; in the agent manager, the chat's. */
          <ModelPicker providerId={provider.id} model={model}
            onPick={own ? own.pick : profile && ((providerId, model) => void agentStore.update(profile.id, { providerId, model }))} />
        }
      />
    </div>
  );
}
