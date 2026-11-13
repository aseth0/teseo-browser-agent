// The lines under the conversation: compacting, what the agent (or an agent it asked) is doing,
// notices, a run stopped at its step limit, and why a message was not sent or a run failed.
import { useMemo } from 'react';
import type { Message } from '../../core/types';
import { subRunStatus, toolResultsById } from '../../ui/ChatMessages';
import { Icon } from '../../ui/chat-icons';
import { UntilStreaming } from './LiveStream';
import type { Agent } from './useAgent';

// A server that refuses the images of your last message: most likely its model does not take images.
const IMAGES_REFUSED = 'This model may not take images: choose one that does (a "vision" model), or send the message without them.';
const imagesRefused = (history: Message[], error: string) =>
  /image|vision|multimodal/i.test(error) && !!history.findLast((m) => m.role === 'user')?.parts.some((p) => p.type === 'image' && p.data);

interface Props {
  agent: Agent;
  results: ReturnType<typeof toolResultsById>; // the conversation's tool results, by call
  compacting: string | undefined; // what compaction is doing now
  sendError: string;
  onContinue: () => void;
}

export function ChatStatusLines({ agent, results, compacting, sendError, onContinue }: Props) {
  const { history, live, busy, status, error, notices, stepLimit, confirmations } = agent;
  // The agent asked last that has not answered yet: one an agent asked in turn comes after it, and
  // its answer is in that agent's run.
  const subWorking = useMemo(() => {
    const runs = Object.entries(agent.subs);
    const inRuns = new Set(runs.flatMap(([, r]) => [...toolResultsById(r.messages).keys()]));
    return runs.findLast(([callId]) => !results.has(callId) && !inRuns.has(callId))?.[1];
  }, [agent.subs, results]);
  return (
    <>
      {compacting && <div className="msg pending compaction-status" role="status"><span className="status-dot busy" /> {compacting}</div>}
      {busy && !confirmations.length && (
        <UntilStreaming live={live}><div className="msg pending">{status || (subWorking ? <><Icon name="agent" size={12} /> {subRunStatus(subWorking)}</> : '…')}</div></UntilStreaming>
      )}
      {notices.map((n) => <div key={n} className="msg notice">{n}</div>)}
      {stepLimit !== null && !busy && (
        <div className="msg notice step-limit">
          Stopped after {stepLimit} rounds of tool calls without an answer.
          <button onClick={onContinue}>Continue</button>
        </div>
      )}
      {sendError && <div className="msg error">{sendError}</div>}
      {error && <div className="msg error">{error}{imagesRefused(history, error) && <div className="small">{IMAGES_REFUSED}</div>}</div>}
    </>
  );
}
