// The conversation as the chat shows it, a turn at a time, with the actions under your message and
// the answer, and the model's steps grouped in collapsible blocks.
import { Fragment, useContext, useMemo, useState, type ReactNode } from 'react';
import { ASK_WIRE } from '../../agents/ask';
import { agentLabel, agentStore, type AgentProfile } from '../../agents/profiles';
import { isPanelNotice, noticeLine } from '../../core/messages';
import { stripMarks } from '../../core/model-texts';
import type { Compaction, Message, Part } from '../../core/types';
import type { TextFormat } from '../../storage/settings-types';
import { CopyIconButton, IconButton, REGENERATE_ICON } from '../icons';
import { markdownToJira } from '../jira-markup';
import { keyOf } from '../keys';
import { useCollection } from '../useCollection';
import { ChatActionsContext, ChatViewContext, DisplayContext, stepsOf } from './contexts';
import { AttachedChips, AutoList, messageAttached } from './AttachedChips';
import { compactionLabel, compactionLeftOut, compactionMarkTitle, compactionShort, leftOutSentence } from './compaction-text';
import { ReplacedContext } from './replaced';
import { DotLine, stepCounts } from './step-counts';
import { MessageView } from './MessageView';
import { TurnDiagram } from './TurnDiagram';
import { SpeakButton } from './SpeakButton';
import { speakable } from '../../speech/markdown';
import { segmentsOf, turnsOf, turnStats, typedText, whole, type ToolResultPart, type Turn } from './turns';

// What goes with a message of the history (Layers): `trailing` at the end of its last line (that of
// its block of steps, when its last piece is in one; the row of its actions, for your message and
// the answer), `below` under it (under that block or row).
interface MessageLayers {
  trailing: (ms: Message[]) => ReactNode; // the messages whose layers go together: those whose calls a block of steps folds
  below: (ms: Message[]) => ReactNode;
}

// The conversation as the chat shows it, a turn at a time: your message and what the model did,
// each with its actions. With the steps grouped (Settings → Appearance), the reasoning and tool calls
// between your message and the answer go in collapsible blocks; what the model writes stays in view.
// `diagrams`: each turn's steps drawn above its answer, the steps folded under the drawing (TurnDiagram).
export function ChatHistory(props: { history: Message[]; results: Map<string, ToolResultPart>; running: boolean; format: TextFormat; layers?: MessageLayers; diagrams?: boolean }) {
  const { history, results, running, format, layers, diagrams = false } = props;
  const chatView = useContext(ChatViewContext);
  const grouped = stepsOf(chatView) === 'grouped';
  const apart = grouped || diagrams; // the answer shown apart from the steps
  const agents = useCollection(agentStore);
  const turns = turnsOf(history);
  const segments = turns.map((turn) => (grouped ? segmentsOf(turn.steps) : []));
  // The last piece of each message, as the pieces are shown: its layers go there.
  const shown = turns.flatMap((turn, t) => [
    ...(turn.user ? [turn.user] : []),
    ...(apart
      ? [...(grouped ? segments[t]!.flatMap((seg) => (seg.kind === 'text' ? [seg.message] : seg.messages)) : turn.steps), ...(turn.answer ? [turn.answer] : [])]
      : turn.messages),
  ]);
  const last = new Set<Message>();
  const seen = new Set<Message>();
  for (const m of layers ? shown.toReversed() : []) {
    if (seen.has(whole(m))) continue;
    seen.add(whole(m));
    last.add(m);
  }
  // Only the last turn runs: the earlier ones keep equal props, and their memoized views are not
  // rendered again while it does.
  const runningAt = (t: number) => running && t === turns.length - 1;
  // Turns and messages are keyed by their message, not their place: regenerated from a turn, the new
  // one does not get the old one's state (a pill or a block opened).
  const view = (m: Message, isRunning: boolean) => (
    <Fragment key={keyOf(m)}>
      <MessageView message={m} results={results} running={isRunning} format={format} trailing={last.has(m) ? layers?.trailing([whole(m)]) : undefined} />
      {last.has(m) && layers?.below([whole(m)])}
    </Fragment>
  );
  const steps = (seg: Message[], isRunning: boolean) => {
    const ends = seg.filter((m) => last.has(m)).map(whole);
    return (
      <Fragment key={keyOf(seg[0]!)}>
        <Steps steps={seg} results={results} running={isRunning} format={format} trailing={ends.length ? layers?.trailing(ends) : undefined} />
        {ends.length > 0 && layers?.below(ends)}
      </Fragment>
    );
  };
  // A turn's steps as the view shows them (with the answer, when not apart); with the diagrams, under
  // its drawing.
  const stepsOfTurn = (turn: Turn, t: number) => {
    const runningHere = runningAt(t);
    const shownSteps = grouped
      ? segments[t]!.map((seg, i, all) => (seg.kind === 'text' ? view(seg.message, runningHere) : steps(seg.messages, runningHere && i === all.length - 1)))
      : (apart ? turn.steps : turn.messages).map((m) => view(m, runningHere));
    if (!diagrams || (!turn.steps.length && !runningHere)) return shownSteps;
    return (
      <TurnDiagram id={`turn${t}-`} user={turn.user} messages={turn.messages} steps={turn.steps} results={results} answered={!!turn.answer}
        stopped={!!(turn.user?.stopped || turn.messages.some((m) => m.stopped))} running={runningHere} latest={t === turns.length - 1}>
        {shownSteps}
      </TurnDiagram>
    );
  };
  // Each compaction's mark goes where it ran: after the turn that ended the chat then.
  const compactions = history.flatMap((m) => (m.compaction?.ranAfter ? [m.compaction] : []));
  let ends = 0;
  const turnEnds = turns.map((turn) => (ends += (turn.user ? 1 : 0) + turn.messages.length));
  return (
    <>
      {turns.map((turn, t) => (
        <Fragment key={keyOf(turn.user ?? turn.messages[0]!)}>
          {turn.user?.compaction && <CompactionDivider compaction={turn.user.compaction} />}
          {turn.user && (
            <>
              {isPanelNotice(turn.user) ? (
                <PanelNotice message={turn.user} />
              ) : (
                <>
                  <MessageView message={turn.user} results={results} running={runningAt(t)} format={format} chips={false} />
                  <UserActions message={turn.user} trailing={layers?.trailing([turn.user])} />
                </>
              )}
              {layers?.below([turn.user])}
            </>
          )}
          {stepsOfTurn(turn, t)}
          {apart && turn.answer && <MessageView message={turn.answer} results={results} running={runningAt(t)} format={format} />}
          {(turn.user?.stopped || turn.messages.some((m) => m.stopped)) && (
            <div className="msg-stopped" title="The model is told on your next message">Stopped by you</div>
          )}
          {turn.answer && <AnswerActions turn={turn} answer={turn.answer} format={format} agents={agents} trailing={apart ? layers?.trailing([whole(turn.answer)]) : undefined} />}
          {apart && turn.answer && layers?.below([whole(turn.answer)])}
          {compactions.filter((c) => c.ranAfter === turnEnds[t]).map((c) => <CompactionMark key={c.at} compaction={c} />)}
        </Fragment>
      ))}
    </>
  );
}

// Where the earlier turns start going to the model compacted (context/compaction): what it saved,
// and on opening it, what it left out or the summary.
function CompactionDivider({ compaction: c }: { compaction: Compaction }) {
  const left = compactionLeftOut(c);
  return (
    <details className="compaction-divider" data-compaction={c.at}>
      <summary title="The turns above (and the first messages below, if it says so) go to the model compacted from here on; the chat and the saved conversation keep them whole">
        Compacted · {compactionLabel(c)}
      </summary>
      <div className="compaction-body">
        {c.turns > 0 && (c.summary ? <><div className="muted small">Summary sent in their place:</div><div className="pre-line">{c.summary}</div></> : <div className="muted small">{leftOutSentence(c)}</div>)}
        {c.inner && <div className="muted small">Below, the first {c.inner} {c.inner === 1 ? 'message goes' : 'messages go'} without their {left || 'nothing'} too; the latest ones go whole.</div>}
        {c.short && <div className="muted small">{compactionShort(c)}</div>}
      </div>
    </details>
  );
}

// When a compaction ran, where the chat was then (its divider sits higher, where the turns it kept
// start): what it did, and a link that brings its divider into view, opened.
function CompactionMark({ compaction: c }: { compaction: Compaction }) {
  const show = () => {
    const divider = document.querySelector<HTMLDetailsElement>(`.compaction-divider[data-compaction="${c.at}"]`);
    if (!divider) return;
    divider.open = true;
    divider.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  return (
    <div className="compaction-mark" role="note" title={compactionMarkTitle(c)}>
      <span>Compacted here · {compactionLabel(c)}</span>
      <button type="button" className="link-button" onClick={show}>↑ Show where</button>
    </div>
  );
}

// A notice from an agent of the Agents Panel this chat started (Part from): a line, not your message.
function PanelNotice({ message }: { message: Message }) {
  return <div className="msg-event" role="note" title="An agent this conversation started in the Agents Panel; the model got it as a message">{noticeLine(message)}</div>;
}

// Under your message: copy it and send it again; its layers first (`trailing`).
// Its row stays under the bubble; a pill opened lists what went under the row, not in it.
function UserActions({ message, trailing }: { message: Message; trailing?: ReactNode }) {
  const { busy, regenerate, openMemory } = useContext(ChatActionsContext);
  const [shown, setShown] = useState<string>();
  const replaced = useContext(ReplacedContext);
  const open = shown ? messageAttached(message, openMemory, replaced).groups.find((g) => g.key === shown) : undefined;
  return (
    <div className="msg-actions-block">
      <div className="msg-actions user">
        <AttachedChips message={message} className="msg-actions-chips" shown={shown} onShow={setShown} />
        {trailing}
        <CopyIconButton label="Copy the message" text={typedText(message)} />
        {regenerate && (
          <IconButton label="Regenerate from here: sends this message again (the page is read again) and drops what came after it" icon={REGENERATE_ICON}
            disabled={busy} onClick={() => regenerate(message)} />
        )}
      </div>
      {open && <AutoList group={open} />}
    </div>
  );
}

// Under the model's answer: the agent that gave it (none for Default), copy it, read it aloud (with that
// agent's voice), regenerate the turn,
// and its tokens and response time; with its layers (`trailing`), not those stats: the layers show
// each call's as the server reported it. The agent and the stats as Settings → Display says.
// `answer`: the turn's.
function AnswerActions({ turn, answer, format, agents, trailing }: { turn: Turn; answer: Message; format: TextFormat; agents: AgentProfile[]; trailing?: ReactNode }) {
  const { busy, regenerate, speak } = useContext(ChatActionsContext);
  const display = useContext(DisplayContext);
  const { user } = turn;
  const who = display.answerAgent === 'hidden' ? undefined : user?.agent ? agents.find((a) => a.id === user.agent) : undefined; // one deleted since: not named
  const text = stripMarks(answer.parts.map((p) => (p.type === 'text' ? p.text : '')).join(''));
  const copied = useMemo(() => (format === 'jira' ? markdownToJira(text) : text.trim()), [text, format]);
  const stats = trailing || display.answerStats === 'hidden' ? undefined : turnStats(turn.messages);
  return (
    <div className="msg-actions">
      {who && <span className="msg-agent" title={`Answered by the agent ${who.name}`}>{agentLabel(who)}</span>}
      {trailing}
      <CopyIconButton label={`Copy the answer (${format === 'jira' ? 'Jira markup' : 'Markdown'})`} text={copied} />
      {speak && <SpeakButton speak={speak} speakKey={`answer:${keyOf(answer)}`} text={speakable(text)} agentId={user?.agent} label="Read the answer aloud" />}
      {regenerate && user && (
        <IconButton label="Regenerate: sends your message again (the page is read again) and replaces this answer" icon={REGENERATE_ICON}
          disabled={busy} onClick={() => regenerate(user)} />
      )}
      {stats && <span className="msg-stats" title={stats.detail}>{stats.label}</span>}
    </div>
  );
}

// One stretch of a turn's steps, collapsed: what it did, and while it runs, what it is doing.
// `trailing`: at the end of its line (Layers).
function Steps(props: { steps: Message[]; results: Map<string, ToolResultPart>; running: boolean; format: TextFormat; trailing?: ReactNode }) {
  const { steps, results, running, format } = props;
  const showReasoning = (useContext(ChatViewContext).reasoning ?? 'collapsed') !== 'hidden';
  const parts = steps.flatMap((m) => (m.role === 'assistant' ? m.parts : []));
  const thoughts = showReasoning ? parts.filter((p) => p.type === 'reasoning' && p.text.trim()).length : 0;
  const calls = parts.filter((p): p is Extract<Part, { type: 'tool_call' }> => p.type === 'tool_call');
  const errors = calls.filter((c) => results.get(c.id)?.isError).length;
  const pending = running ? calls.find((c) => !results.has(c.id)) : undefined;
  // Open while another agent works in it, to follow it live.
  const asking = pending?.name === ASK_WIRE;
  const summary = [...(running ? [<>{pending ? `Running ${pending.name}…` : 'Working…'}</>] : []), ...stepCounts({ thoughts, tools: calls.length, errors })];
  return (
    <details className={`steps${running ? ' running' : ''}`} open={asking || undefined}>
      <summary>
        {summary.length ? <DotLine parts={summary} /> : 'Steps'}
        {props.trailing && <span className="layer-chips">{props.trailing}</span>}
      </summary>
      <div className="steps-body">
        {steps.map((m) => <MessageView key={keyOf(m)} message={m} results={results} running={running} format={format} />)}
      </div>
    </details>
  );
}
