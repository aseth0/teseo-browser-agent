// How the chat's messages go: the run's options (the provider, the model, the page and what is left
// out), your message compacted first when it has to be, yours queued while the agent works
// (send-queue), a message the page widget queued, a tab watch met, a reply regenerated and a run
// continued past its step limit.
import { useEffect, useRef, useState } from 'react';
import type { AgentProfile } from '../../agents/profiles';
import type { AutoInjectKind } from '../../context/auto-inject';
import { audioPart, filePart, pdfPart } from '../../context/attached-file';
import { recordingSource } from '../../context/sources';
import { errorText } from '../../core/errors';
import type { KeptText } from '../../core/kept-results';
import type { ImagePayload, Message, Part, SentText } from '../../core/types';
import { recordingBlock } from '../../recording/block';
import { recordedCalls, type Recording } from '../../recording/recording';
import { applyModelSettings } from '../../context/model-settings';
import type { ProviderConfig } from '../../storage/settings';
import { thinkingLevel } from '../../storage/settings-select';
import { useStableCallback } from '../../ui/useStableCallback';
import type { QueuedMessage } from './Chat';
import { afterTurn, backToBox, enqueue, queueFull, type QueuedText } from './send-queue';
import { useSettingsContext } from '../../ui/settings-context';
import { FULL } from '../../ui/floating-frame';
import { PREVIEW_ID, type Agent } from './useAgent';
import type { useAttachments } from './useAttachments';
import type { useCompaction } from './useCompaction';
import type { PageTarget } from './usePageTarget';
import { useWatchContinuation } from './WatchesMenu';
import { useManagerSays, userSpoke } from './manager-chat';
import { MANAGER_AGENT, MANAGER_PANEL_ROW } from '../../ui/floating-frame';

// The chat floating on a page, showing the pinned conversation (sidepanel/floating): every run of it
// (a message, Regenerate, Continue, a met tab watch's) is claimed first, and goes only once claimed.
export interface RunGate {
  off?: string; // why nothing goes now (another tab runs it): Send off
  autoOff: boolean; // nothing goes on its own now (its tab hidden, or another tab runs it)
  claim: () => Promise<string | undefined>; // why it cannot go, if so (said, and nothing changes)
  unclaim: () => void; // claimed, but the run did not start
}

interface Pipeline {
  agent: Agent;
  page: PageTarget;
  queued: QueuedMessage | undefined;
  runGate?: RunGate;
  provider: ProviderConfig | undefined;
  model: string;
  profile: AgentProfile | undefined;
  includePage: boolean;
  noSelection: boolean;
  skip: AutoInjectKind[];
  blacklistChoice?: 'on' | 'off'; // what the user chose for the word blacklist in this conversation
  input: string;
  setInput: (update: (now: string) => string) => void;
  attachments: ReturnType<typeof useAttachments>;
  recording: Recording | undefined;
  compaction: ReturnType<typeof useCompaction>;
  onSent: () => void; // the recording and the selection skipped go with the message
}

export function useSendPipeline({ agent, page, queued, runGate, provider, model, profile, includePage, noSelection, skip, blacklistChoice, input, setInput, attachments, recording, compaction, onSent }: Pipeline) {
  const { settings } = useSettingsContext();
  const { history, busy, send: sendToAgent, resume, regenerate } = agent;
  const runOptions = (p: ProviderConfig) => ({
    providerId: p.id,
    model,
    tabId: page.tabId,
    includePage: includePage && page.access === 'ok',
    noSelection,
    thinking: thinkingLevel(settings, p.id, model),
    agentId: profile?.id,
    skip,
    contextWindow: compaction.autoWindow, // the model's, for the run to fit its requests in
    contextWindowSource: compaction.autoWindowSource, // 'default': a guess, the run shortens less on it
    conversationId: agent.conversationId, // the one open now: it goes only if still open when it is sent
    // The tab you look at, when not the chat's. Full screen, you look at the chat itself: none.
    ...(page.elsewhere && !FULL && { userTab: page.elsewhere }),
    ...(blacklistChoice && { wordBlacklist: blacklistChoice === 'on' }),
    ...(MANAGER_PANEL_ROW && { panelRow: MANAGER_PANEL_ROW }),
  });
  // Why the page does not go with a message, if it does not.
  const pageSkipped = () => (!includePage ? 'off' : page.access !== 'ok' ? 'unreadable' : undefined);
  // Stable while nothing they show changes: streamed text re-renders the chat many times a second.
  const regenerateLatest = useStableCallback((from: Message) => {
    if (!busy && provider && model) void claimed(() => regenerate(from, runOptions(provider)));
  });

  // The widget's message, once the conversation is new, its agent chosen and its page (the tab the
  // widget is on) known, so it goes with the page as any message.
  const sent = useRef(0);
  const sendQueued = useStableCallback((q: QueuedMessage, p: ProviderConfig) => sendToAgent({ text: q.text, ...(q.shown !== undefined && { shown: q.shown }) }, runOptions(p), pageSkipped()));
  useEffect(() => {
    if (!provider || !queued || sent.current === queued.at || busy || compaction.compacting || history.length || !model || page.tabId === undefined || profile?.id !== queued.agentId) return;
    sent.current = queued.at;
    sendQueued(queued, provider);
  }, [queued, busy, compaction.compacting, history.length, provider, model, profile?.id, page.tabId, sendQueued]);
  // A message that goes once idle: a tab watch set from this conversation was met; in the Agents Panel,
  // what the agent that started this chat gives it (agents/panel), in order.
  const sendIdle = useStableCallback((message: string | SentText) => provider && sendToAgent(message, runOptions(provider), pageSkipped()));
  const sendWatched = useStableCallback((message: string) => (provider ? claimed(() => sendToAgent(message, runOptions(provider), pageSkipped())) : false));
  const idle = !!provider && !!model && !busy && !compaction.compacting;
  useWatchContinuation(agent.conversationId, idle && agent.conversationId !== PREVIEW_ID && !runGate?.autoOff, sendWatched);
  // Not before its agent (the row's) is read: it would go to the settings' model.
  useManagerSays(idle && page.tabId !== undefined && (!MANAGER_AGENT || profile !== undefined), sendIdle);
  // Why the last message was not sent: it stays in the message box.
  const [sendError, setSendError] = useState('');
  // A run, once claimed (RunGate): whether it went. Not claimed, why is said.
  async function claimed(go: () => boolean): Promise<boolean> {
    const why = await runGate?.claim();
    if (why) {
      setSendError(why);
      return false;
    }
    const went = go();
    if (!went) runGate?.unclaim();
    return went;
  }

  // Compacted first when the context reached Settings → Compaction's threshold. 'refused': a turn
  // started meanwhile, or another conversation was opened.
  // `kept`: the attached files that were cut, whole, for tools.read_more.
  // `base`: the history compacted just before (after the turn), as it goes.
  const deliver = async (p: ProviderConfig, text: string, images: ImagePayload[] = [], attached: Part[] = [], kept: KeptText[] = [], base?: Message[]): Promise<'sent' | 'failed' | 'refused'> => {
    const options = kept.length ? { ...runOptions(p), kept } : runOptions(p);
    setSendError('');
    const why = await runGate?.claim();
    if (why) {
      setSendError(why);
      return 'failed';
    }
    let sending: Message[];
    try {
      sending = base ?? (await compaction.beforeSend());
    } catch (e) {
      runGate?.unclaim();
      setSendError(`Not sent: the earlier turns could not be compacted (${errorText(e)}).`);
      return 'failed';
    }
    if (!sendToAgent(text, options, pageSkipped(), sending, images, attached)) {
      runGate?.unclaim();
      return 'refused';
    }
    userSpoke(); // in the Agents Panel, notices may wake the chat again
    return 'sent';
  };

  const [queue, setQueue] = useState<QueuedText[]>([]);
  const queueId = useRef(0);
  const dequeue = (id: number) => setQueue((q) => q.filter((x) => x.id !== id));
  // Back to the message box, to change it (only into an empty one: nothing there is overwritten).
  const editQueued = (id: number) => {
    const q = queue.find((x) => x.id === id);
    if (!q || input.trim()) return;
    setInput(() => q.text);
    dequeue(id);
  };
  // `first`: one taken from it that did not go.
  const queueBack = useStableCallback((first?: QueuedText) => {
    const all = first ? [first, ...queue] : queue;
    if (!all.length) return;
    setInput((now) => backToBox(now, all));
    setQueue([]);
  });
  // One taken from the queue. Refused (another message went first, a watch met): it waits for that
  // turn's end. Not compacted: back to the box with the rest, as the message would stay there.
  const deliverQueued = async (p: ProviderConfig, q: QueuedText, base?: Message[]) => {
    const r = await deliver(p, q.text, [], [], [], base);
    if (r === 'refused') setQueue((x) => [q, ...x]);
    else if (r === 'failed') queueBack(q);
  };
  // A turn stopped to send at once (sendInstead): what is in the box, or the queued one `id`.
  const instead = useRef<{ id?: number }>(undefined);
  // A turn's end: compacted first when the model asked for it (chat.compact); then the next queued
  // message goes, or all go back to the box. Another conversation drops them (opening one stops the
  // turn: that is not this end).
  const turnEnded = useStableCallback(() => {
    const now = instead.current;
    instead.current = undefined;
    if (now) return sendInsteadGo(now.id);
    const compacted = compaction.afterTurn();
    if (!compacted) return nextQueued();
    void compacted.then(nextQueued);
  });
  // As the queue is once that compaction is done; `base`: the history it left.
  const nextQueued = useStableCallback((base?: Message[]) => {
    const [next, ...rest] = queue;
    if (!next) return;
    if (!provider || !model || afterTurn(agent) === 'back') return queueBack();
    setQueue(rest);
    void deliverQueued(provider, next, base);
  });
  const dropQueue = useStableCallback(() => setQueue([]));
  const was = useRef({ busy, conversationId: agent.conversationId });
  useEffect(() => {
    const before = was.current;
    was.current = { busy, conversationId: agent.conversationId };
    if (before.conversationId !== agent.conversationId) dropQueue();
    else if (before.busy && !busy) turnEnded();
    else if (!before.busy && busy) instead.current = undefined; // the turn had ended before its stop
  }, [busy, agent.conversationId, dropQueue, turnEnded]);

  // Something in the box to send: text, an attachment or a recording.
  const canSend = !!input.trim() || !!attachments.images.length || !!attachments.files.length || !!recording;
  // What is in the box, with what is attached.
  const sendBox = async (p: ProviderConfig) => {
    const text = input.trim();
    const { images, files } = attachments;
    applyModelSettings(settings); // the recording's text and limit as Settings has them
    const filed = files.map((f) => ('text' in f ? filePart(f.name, f.text) : 'audio' in f ? audioPart(f.audio) : pdfPart(f.name, f.pdf)));
    const attached = [
      ...(recording ? [{ type: 'text' as const, context: 'page' as const, source: recordingSource(recording.site, recordedCalls(recording).length), text: recordingBlock(recording) }] : []),
      ...filed.map((f) => f.part),
    ];
    const kept = filed.flatMap((f) => (f.kept ? [f.kept] : []));
    const sent = await deliver(p, text, images.map((a) => a.image), attached, kept);
    // Another conversation opened while compacting: the message stays in the box, for that one.
    if (sent === 'refused') setSendError('Not sent: another conversation was opened meanwhile.');
    if (sent !== 'sent') return;
    // Emptied once it goes, unless it was changed meanwhile (the box stays editable while compacting).
    setInput((now) => (now === input ? '' : now));
    attachments.clear([...images, ...files]);
    onSent();
  };
  const send = async () => {
    // While the agent works: the text waits (what is attached stays in the box, for when it is idle).
    if (busy) {
      const text = input.trim();
      if (!text || queueFull(queue)) return;
      setQueue((q) => enqueue(q, text, ++queueId.current));
      setInput((now) => (now === input ? '' : now));
      return;
    }
    if (!provider || !canSend || compaction.compacting || !model) return;
    await sendBox(provider);
  };
  // While the agent works: it is stopped, as with Stop, and what is in the box (or the queued one
  // `id`) goes at once. The others stay queued, for after it. Idle: as Enter.
  const sendInstead = (id?: number) => {
    if (!busy) return id === undefined ? void send() : undefined;
    if (!provider || !model || (id === undefined ? !canSend : !queue.some((x) => x.id === id))) return;
    instead.current = { id };
    agent.stop({ interrupted: true });
  };
  // Once the stop is seen (turnEnded): the history then has the stopped turn, so the model is told.
  const sendInsteadGo = (id: number | undefined) => {
    if (!provider || !model) return;
    if (id === undefined) {
      if (canSend) void sendBox(provider);
      return;
    }
    const q = queue.find((x) => x.id === id);
    if (!q) return;
    dequeue(q.id);
    void deliverQueued(provider, q);
  };
  // Stopped: what was queued goes back to the box, not after the stop.
  const stopRun = () => {
    queueBack();
    agent.stop();
  };
  // The message box is memoized (it re-renders as you type): its handler keeps one identity.
  const sendNow = useStableCallback(() => void send());
  const continueRun = () => void (provider && claimed(() => resume(runOptions(provider))));

  const sendInsteadNow = useStableCallback(sendInstead);
  const waiting = { items: queue, edit: editQueued, remove: dequeue };
  return { send, sendNow, sendInsteadNow, canSend, sendError, regenerateLatest, continueRun, stopRun, waiting };
}
