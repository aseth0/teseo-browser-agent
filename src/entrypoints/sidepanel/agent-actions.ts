// What the chat does with its conversation (sidepanel/useAgent): run, send, stop, answer a card,
// compact, open another. They read the store's state when called, so one called right after a dispatch
// sees it.
import type { PanelToBackground } from '../../core/protocol';
import type { Compaction, ImagePayload, Message, Part, SentText, UserReply } from '../../core/types';
import { withCompaction } from '../../context/compaction';
import { attachedByYou } from '../../context/sources';
import type { Decision } from '../../policy/engine';
import type { createAgentStore } from './agent-store';
import type { AgentPort } from './useAgentPort';

type RunOptions = Omit<Extract<PanelToBackground, { type: 'run' }>, 'type' | 'history' | 'runId'>;

export function agentActions(store: ReturnType<typeof createAgentStore>, { post, connectAndPost, setStopped, newRun }: AgentPort) {
  const { dispatch } = store;
  // A run or an attach: one that cannot reach the agent ends the run.
  const reach = (msg: PanelToBackground) => {
    const failed = connectAndPost(msg);
    if (failed) dispatch({ type: 'finish', error: `Could not reach the agent: ${failed}` });
  };
  // False when the conversation it was meant for (`opts.conversationId`, else the open one) is no
  // longer the one open: another was opened meanwhile (e.g. while the earlier turns were compacted).
  // Also while a turn runs or the earlier turns are being compacted (the store's state as of now).
  const run = (next: Message[], opts: RunOptions): boolean => {
    const { conversationId, busy, compacting } = store.shown();
    if ((opts.conversationId ?? conversationId) !== conversationId) return false;
    if (busy || compacting) return false;
    dispatch({ type: 'run', history: next });
    setStopped(false);
    reach({ type: 'run', runId: newRun(), history: next, ...opts, conversationId, sentAt: Date.now() });
    return true;
  };
  // `text`: yours, or with how the chat shows it (Part shown), and whether an agent of the panel wrote it (Part from).
  // `pageSkipped`: why the page goes without its block ("Page" off, or a tab that cannot be read).
  // `base`: the history to go on from (compacted just before), else the current one. `images`: yours.
  // `attached`: what you attached besides (a recording of the page's requests).
  const send = (text: string | SentText, opts: RunOptions, pageSkipped?: Message['pageSkipped'], base = store.shown().history, images: ImagePayload[] = [], attached: Part[] = []) =>
    run([...base, { role: 'user', parts: [{ type: 'text', ...(typeof text === 'string' ? { text } : text) }, ...images.map((i) => ({ type: 'image' as const, ...i })), ...attached], ...(pageSkipped && { pageSkipped }), ...(opts.agentId && { agent: opts.agentId }) }], opts);
  // After the step limit: the history ends with tool results, so the model picks up from there.
  const resume = (opts: RunOptions) => run(store.shown().history, opts);
  // Sends one of your messages again, dropping what came after it. What the extension attached to it
  // goes too: the background attaches the page as it is now. A recording or a file you attached stays.
  const regenerate = (from: Message, opts: RunOptions) => {
    const { history } = store.shown();
    const at = history.indexOf(from);
    if (at < 0) return false;
    return run([...history.slice(0, at), { role: 'user', parts: from.parts.filter((p) => !(p.type === 'text' && p.context && !attachedByYou(p.source))) }], opts);
  };

  // What was streamed so far stays in the conversation, marked as stopped. The background sends
  // nothing more from this run. `interrupted`: to send a message at once (sidepanel/send-queue).
  const stop = ({ interrupted = false } = {}) => {
    post({ type: 'stop' });
    setStopped(true);
    dispatch({ type: 'stop', interrupted });
  };

  // Answers a confirmation card and removes it. An answer that cannot go ends the run: the one
  // waiting for it went with the connection (a new port is another session, which never asked).
  const reply = (msg: Extract<PanelToBackground, { type: 'confirm-reply' | 'access-reply' | 'user-reply' | 'more-steps-reply' }>) => {
    dispatch(post(msg) ? { type: 'answered', id: msg.id } : { type: 'lost' });
  };
  const respond = (id: string, decision: Decision, comment?: string, edits?: Record<string, string>) => reply({ type: 'confirm-reply', id, decision, comment, ...(edits && { edits }) });
  const respondAccess = (id: string, granted: boolean) => reply({ type: 'access-reply', id, granted });
  const respondUser = (id: string, answer: UserReply) => reply({ type: 'user-reply', id, reply: answer });
  const respondMore = (id: string, more: boolean) => reply({ type: 'more-steps-reply', id, more });

  // Between turns: the earlier turns go compacted from the message at `at` on (context/compaction),
  // in the conversation it was worked out for: dropped if another was opened meanwhile.
  const compact = (at: number, compaction: Compaction, conversationId: string) => {
    const { history, conversationId: open } = store.shown();
    if (conversationId !== open) return history;
    const next = withCompaction(history, at, compaction);
    dispatch({ type: 'history', conversationId, history: next, compaction });
    return next;
  };
  const setCompacting = (on: boolean) => dispatch({ type: 'compacting', on });
  // In the conversation, to stay so; a run going on is told, for what it sends next.
  const dismissPlan = (id: string) => {
    dispatch({ type: 'plan-dismissed', id });
    if (store.shown().busy) post({ type: 'plan-dismissed', id });
  };

  const reset = () => dispatch({ type: 'load', conversationId: crypto.randomUUID(), history: [] });

  // A saved conversation, to go on with it. A run of it still going on, away from its chat (the
  // floating chat's page reloaded), comes back here (the background sends 'resume').
  const open = (id: string, saved: Message[]) => {
    if (store.shown().busy) stop();
    dispatch({ type: 'load', conversationId: id, history: saved });
    reach({ type: 'attach', conversationId: id });
  };

  return { send, resume, regenerate, stop, respond, respondAccess, respondUser, respondMore, reset, open, compact, dismissPlan, setCompacting };
}
