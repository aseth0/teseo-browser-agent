// Compacting the chat's conversation (context/compaction): on its own before a message once the
// context reaches Settings → Compaction's threshold of the model's window (or of the one set for an
// unknown window), or from the context meter.
// It goes as far as it takes to bring the context under half the threshold (context/compaction
// compactionStep); from the meter with the window unknown, the earlier turns summarized. And when a
// turn the model called chat.compact in ends (or its conversation is opened after it did), with the
// call's instructions for the summary.
import { useEffect, useRef, useState } from 'react';
import { errorText } from '../../core/errors';
import { compactCall, compactedNote, compactedTokens, compactedView, compactionOf, compactionStep, fixedNote, nothingToCompactNote, shortOf, trimmedAt } from '../../context/compaction';
import { corrected, messagesTokens } from '../../context/budget';
import { useTokenRatio } from './useTokenRatio';
import { useStableCallback } from '../../ui/useStableCallback';
import { contextUsed } from '../../context/usage';
import { windowInForce, type ContextWindow } from '../../context/window';
import { stripMarks } from '../../core/model-texts';
import { SUMMARIZE, type SummarizeReply, type SummarizeRequest } from '../../core/protocol';
import { sendRuntime } from '../../core/runtime';
import type { Compaction, Message } from '../../core/types';
import { transcriptOf } from '../../history/read';
import type { ProviderConfig, Settings } from '../../storage/settings';
import type { Agent } from './useAgent';
import { wentMasked } from '../../word-blacklist/gate';

export function useCompaction(agent: Agent, settings: Settings, window: ContextWindow, target: { provider?: ProviderConfig; model: string }) {
  const { compacting, setCompacting } = agent; // in the agent's state: the side panel opens no other conversation meanwhile
  const [status, setStatus] = useState(''); // what it is doing, for the chat's line while it runs
  const [note, setNote] = useState('');
  const cfg = compactionOf(settings.compaction);
  const ratio = useTokenRatio(target.provider?.id, target.model); // estimates corrected for the model
  const used = () => (agent.usage.last ? contextUsed(agent.usage.last) : corrected(messagesTokens(compactedView(agent.history).messages), ratio));
  // On its own, with the model's window unknown: the one Settings → Compaction sets for that (none: 0).
  const inForce = windowInForce(window, cfg);
  const autoWindow = inForce.tokens;
  // The system prompt's and the tools' part of the last request, which compaction cannot shorten.
  const fixedPart = () => {
    const b = agent.usage.last?.breakdown;
    return b && { system: corrected(b.system, ratio), tools: corrected(b.tools, ratio) };
  };
  const percent = () => (autoWindow ? (used() / autoWindow) * 100 : undefined);

  // The history compacted, or as it was when there is nothing to compact. `instructions`: for the
  // summary, which then is always written (unless summaries are off).
  const compact = async (auto: boolean, instructions?: string): Promise<Message[]> => {
    const by = cfg.providerId && cfg.model ? { providerId: cfg.providerId, model: cfg.model } : target.provider && { providerId: target.provider.id, model: target.model };
    const now = used();
    const tokens = auto ? autoWindow : window.tokens;
    const { conversationId } = agent; // the one it is worked out for: kept only if still open at the end
    const step = compactionStep(agent.history, cfg, { used: now, window: tokens, canSummarize: !!by, auto, ratio, force: !!instructions });
    if (!step) {
      if (!auto) setNote(nothingToCompactNote(!!tokens, cfg.keepTurns, fixedNote(fixedPart(), now)));
      return agent.history;
    }
    setCompacting(true);
    setNote('');
    try {
      const what = step.turns ? `${step.turns} earlier ${step.turns === 1 ? 'turn' : 'turns'}` : 'the latest turn';
      setStatus(`Compacting ${what}: trimming…`);
      const compaction: Compaction = {
        at: Date.now(), turns: step.turns, trimmed: cfg.trim, before: step.before, after: step.after, ranAfter: agent.history.length, ...(step.inner && { inner: step.inner }),
        ...(instructions && { instructions }),
      };
      if (instructions && !cfg.summarize) setNote('Not summarized: summaries are off in Settings → Compaction.');
      if (step.summarize && by) {
        setStatus(`Compacting ${what}: summarizing with ${by.model}…`);
        // The model's replies go whole to the summary: they are much of what it keeps.
        const transcript = stripMarks(transcriptOf({ history: trimmedAt(agent.history, step.at, { ...cfg.trim, replies: false }).trimmed }, true));
        const request: SummarizeRequest = { type: SUMMARIZE, ...by, transcript, maxWords: cfg.maxWords, masked: wentMasked(agent.history), ...(instructions && { instructions }) };
        const reply = (await sendRuntime(request).catch((e: unknown): SummarizeReply => ({ error: errorText(e) }))) ?? { error: 'No answer from the extension.' };
        if ('summary' in reply) compaction.summary = reply.summary;
        else setNote(`Not summarized (${reply.error}): the earlier turns go trimmed only.`);
      }
      // As it came out (the summary as written, or none), against the target.
      compaction.after = corrected(compactedTokens(agent.history, step.at, compaction), ratio);
      if (tokens) {
        const fixed = Math.max(0, now - step.before);
        Object.assign(compaction, shortOf(fixed + compaction.after, (tokens * cfg.threshold) / 200, fixed, tokens));
      }
      // Said, as Compact now shows nothing else until the next request (the meter is the last call's).
      if (!auto) {
        const fixed = fixedNote(fixedPart(), now, !compaction.short);
        setNote((n) => [n, compactedNote(what, step.before, compaction.after, fixed)].filter(Boolean).join(' '));
      }
      return agent.compact(step.at, compaction, conversationId);
    } finally {
      setCompacting(false);
      setStatus('');
    }
  };

  // Before a message: compacted when the context reached the threshold.
  const beforeSend = async () => {
    const pct = percent();
    return cfg.auto && pct !== undefined && pct >= cfg.threshold ? compact(true) : agent.history;
  };

  // After a turn: the history compacted when the model asked for it (chat.compact); none when it did
  // not, then and there (what waits for the turn's end goes on at once, as without it), and none when
  // there was nothing to compact or it failed (the note says why).
  const afterTurn = (): Promise<Message[] | undefined> | undefined => {
    const { history } = agent;
    const call = compactCall(history);
    return call && compact(false, call.instructions).then(
      (next) => (next === history ? undefined : next),
      (e: unknown) => void setNote(`Not compacted: ${errorText(e)}`),
    );
  };

  // A conversation opened after such a turn ended away from the chat (the panel closed, another
  // conversation open); a turn's end here goes through afterTurn (useSendPipeline). compactCall finds
  // none once it is compacted, so it runs once.
  const opened = useStableCallback(() => {
    if (!agent.busy && !compacting) void afterTurn();
  });
  useEffect(() => opened(), [agent.conversationId, opened]);

  // What Compact now would take out by trimming alone (a summary takes out more): 0 when nothing.
  // Worked out once for a history and window, as the open popover renders on every streamed piece.
  const freeing = useRef<{ history: Message[]; window?: number; tokens: number }>(undefined);
  const wouldFree = () => {
    const was = freeing.current;
    if (was?.history === agent.history && was.window === window.tokens) return was.tokens;
    const step = compactionStep(agent.history, cfg, { used: used(), window: window.tokens, canSummarize: false, auto: false, ratio });
    const tokens = step ? Math.max(0, step.before - step.after) : 0;
    freeing.current = { history: agent.history, window: window.tokens, tokens };
    return tokens;
  };

  // autoWindow: what a run fits its requests in too (the run message's contextWindow).
  return { wouldFree, compacting, status, note, autoWindow, autoWindowSource: inForce.source, ratio, compactNow: () => void compact(false).catch((e: unknown) => setNote(`Not compacted: ${errorText(e)}`)), beforeSend, afterTurn };
}
