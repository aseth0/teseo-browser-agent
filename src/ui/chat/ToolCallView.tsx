// A tool call as the chat shows it: its arguments, its result nested inside, and what ran inside it
// (another agent, a script tool's steps), made of messages again (ui/chat/MessageView).
import { useContext, useMemo, useState, type MouseEvent, type ReactNode } from 'react';
import { ASK_WIRE } from '../../agents/ask';
import { inBriefOrder } from '../../agents/brief';
import { PANEL_START } from '../../agents/panel';
import { toWireName } from '../../core/tool-registry';
import { argumentDetails } from '../../core/argument-details';
import { cutsIn, stripMarks } from '../../core/model-texts';
import { dataUrlOf, type SubTrace } from '../../core/types';
import { Icon } from '../chat-icons';
import { Code } from '../CodeView';
import { keyOf } from '../keys';
import { DevtoolsBadge } from '../DevtoolsBadge';
import { CutMark } from '../LimitMark';
import { AutoAttached, AutoList, stepGroups } from './AttachedChips';
import { ReplacedContext } from './replaced';
import { ChatActionsContext, ChatViewContext, DisplayContext, SubRunsContext } from './contexts';
import { AssistantText, Reasoning } from './MessageText';
// MessageView imports this file back (a call shows the run inside it as messages): see there.
import { MessageView } from './MessageView';
import { toolJson } from './tool-json';
import { memoryIdOf, ToolMemoryTitle } from './ToolMemoryTitle';
import { toolResultsById, type ToolResultPart } from './turns';

// The tools that take a brief (agents/brief): their arguments shown as fields in the schema's order.
const BRIEF_TOOLS = [ASK_WIRE, toWireName(PANEL_START)];

// A tool call with its arguments; the result is a nested dropdown inside it. Each shows on its own
// from the switches in the row (args, result or error), the result also from its screenshot's thumbnail:
// the call is open while either shows. What shows in the row and how, from Settings → Display (the
// errors, ✂ and the DevTools badge always).
type Shown = { args: boolean; result: boolean };
export function ToolCall({ id, name, args, result, running, trailing }: { id: string; name: string; args: unknown; result?: ToolResultPart; running: boolean; trailing?: ReactNode }) {
  const mode = useContext(ChatViewContext).toolCalls ?? 'collapsed';
  const status = result ? (result.isError ? <><Icon name="error" size={12} /> error</> : <Icon name="ok" size={12} />) : running ? 'running…' : 'not run';
  // Cut to a size limit (Settings → Limits): the model got only part of it.
  const cuts = result ? cutsIn(result.content).map((c, i) => <CutMark key={i} detail={c} />) : null;
  // Compact: one line, without the disclosure arrow; a click still opens the arguments and the result.
  const compact = mode === 'compact';
  // What the switches opened, kept for the view they were opened in: another view (Settings →
  // Appearance) shows the calls already in the chat as it shows new ones.
  const [opened, setOpened] = useState<Shown & { mode: string }>();
  const shown: Shown = opened?.mode === mode ? opened : { args: mode === 'expanded', result: mode === 'expanded' };
  const setShown = (change: (s: Shown) => Shown) => setOpened({ ...change(shown), mode });
  const display = useContext(DisplayContext);
  // What runs inside it: another agent (agents.ask) or a script tool's steps, live or as kept.
  const inside = useContext(SubRunsContext)[id];
  const hasInside = name === ASK_WIRE || !!result?.trace || !!inside;
  // Open while something works inside it, to follow it live.
  const open = shown.args || shown.result || (hasInside && running && !result);
  // The row: closed, it opens on the arguments (compact: both); open, it closes.
  // A button or link in it (a Layers chip) does its own thing, as the browser leaves it.
  const onRow = (e: MouseEvent) => {
    if (e.target instanceof Element && e.target.closest('button, a, input, select, label')) return;
    e.preventDefault();
    setShown(() => (open ? { args: false, result: false } : { args: true, result: compact }));
  };
  const toggle = (part: 'args' | 'result') => (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setShown((s) => ({ ...s, [part]: !s[part] }));
  };
  const resultName = result?.isError ? 'error' : 'result';
  const shot = display.toolScreenshot === 'shown' ? result?.images?.[0] : undefined;
  const output = result && <ToolOutput result={result} />;
  // What went after its result on its own (between the model's steps): pills in its row, the one opened
  // listed under the call, so the row does not move.
  const { openMemory } = useContext(ChatActionsContext);
  const [shownStep, setShownStep] = useState<string>();
  const replaced = useContext(ReplacedContext);
  const steps = result && display.toolAttached === 'shown' ? stepGroups(result, openMemory, replaced) : [];
  const stepOpen = steps.find((g) => g.key === shownStep);
  const memoryId = display.toolMemoryTitle === 'shown' ? memoryIdOf(name, args) : undefined;
  return (
    <>
      <details className={`tool${compact ? ' tool-compact' : ''}${result?.isError ? ' tool-error' : ''}`} open={open}>
        <summary title={compact ? 'Show the arguments and the result' : undefined} onClick={onRow}>
          <Icon name="tool" size={12} /> {name}{result?.devtools && <DevtoolsBadge ran />} <span className="tool-status">{status}</span> {cuts}
          {result?.tab && display.toolTab === 'shown' && <span className="tool-tab" title={`Tab ${result.tab.id}${result.tab.url ? ` · ${result.tab.url}` : ''}, as it was when the tool ran`}><Icon name="tab" size={12} /> {result.tab.title}</span>}
          {memoryId && <ToolMemoryTitle id={memoryId} />}
          <span className="tool-switches">
            {shot && (
              <button type="button" className="tool-thumb" title={`Show the ${resultName}`} onClick={toggle('result')}>
                <img src={dataUrlOf(shot)} alt="screenshot" />
              </button>
            )}
            <button type="button" className="tool-switch" data-part="args" aria-pressed={shown.args} title="Show the arguments" onClick={toggle('args')}>args</button>
            {result && (
              <button type="button" className="tool-switch" data-part="result" aria-pressed={shown.result} title={`Show the ${resultName}`} onClick={toggle('result')}>{resultName}</button>
            )}
          </span>
          {result?.userComment && <span className="tool-comment"><Icon name="comment" size={12} /> {result.userComment}</span>}
          {steps.length > 0 && (
            <span className="tool-attached" onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
              <AutoAttached groups={steps} shown={shownStep} onShow={setShownStep} />
            </span>
          )}
          {trailing && <span className="layer-chips">{trailing}</span>}
        </summary>
        {shown.args && memoryId && <ToolMemoryTitle id={memoryId} inArgs />}
        {shown.args && (display.toolArgs === 'fields' ? <ArgumentFields args={BRIEF_TOOLS.includes(name) ? inBriefOrder(args) : args} /> : <pre className="tool-args">{JSON.stringify(args, null, 2)}</pre>)}
        {hasInside && <SubAgentRun callId={id} agentRun={name === ASK_WIRE} trace={result?.trace} running={running && !result} keepOpen={display.subAgentTrace === 'open'} />}
        {output &&
          (compact ? (
            shown.result && (
              <div className="tool-result">
                <div className="tool-result-head">{result.isError ? <><Icon name="error" size={12} /> error</> : <><Icon name="result" size={12} /> result</>}</div>
                {output}
              </div>
            )
          ) : (
            <details className="tool-result" open={shown.result}>
              <summary onClick={toggle('result')}>{result.isError ? <><Icon name="error" size={12} /> error</> : <><Icon name="result" size={12} /> result</>}</summary>
              {output}
            </details>
          ))}
      </details>
      {stepOpen && <div className="tool-attached-list"><AutoList group={stepOpen} /></div>}
    </>
  );
}

// The arguments as fields (Settings → Display): a name and its value each, as on a confirmation card;
// text as it is (a block when it has several lines), anything else as JSON.
function ArgumentFields({ args }: { args: unknown }) {
  const fields = argumentDetails(args && typeof args === 'object' && !Array.isArray(args) ? args : { value: args });
  if (!fields.length) return <div className="tool-args muted small">No arguments</div>;
  return (
    <dl className="tool-args tool-args-fields">
      {fields.map((f) => (
        <div key={f.label} className={f.code ? 'code' : undefined}>
          <dt>{f.label}</dt>
          <dd>{f.code ? <pre>{f.value}</pre> : f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

// A tool's result: its text, or, when it holds JSON, that JSON indented and colored (Text | JSON; the
// one first from Settings → Display, text by default). Inside an untrusted block, the block's tags stay
// around it and it is always said to come from the web.
function ToolOutput({ result }: { result: ToolResultPart }) {
  const first = useContext(DisplayContext).toolResultView;
  // The one picked, kept for the view it was picked in: another one in Settings shows this result so.
  const [picked, setPicked] = useState<{ first: string; asJson: boolean }>();
  const asJson = picked?.first === first ? picked.asJson : first === 'json';
  const setAsJson = (to: boolean) => setPicked({ first, asJson: to });
  const json = useMemo(() => toolJson(result.content), [result.content]);
  return (
    <>
      {json && (
        <div className="segmented tool-view-switch" role="radiogroup" aria-label="Show the result as">
          <button type="button" role="radio" aria-checked={!asJson} onClick={() => setAsJson(false)}>Text</button>
          <button type="button" role="radio" aria-checked={asJson} onClick={() => setAsJson(true)}>JSON</button>
        </div>
      )}
      {json && asJson ? (
        <pre className="tool-json">
          {json.fromWeb && <span className="tool-json-web" title="Read from a page, a server or a site: untrusted, as the model is told">from the web · untrusted{'\n'}</span>}
          {json.before && <>{json.before}{'\n'}</>}
          <Code source={json.json} lang="json" />
          {json.after && <>{'\n'}{json.after}</>}
        </pre>
      ) : (
        <pre>{stripMarks(result.content)}</pre>
      )}
      {result.images?.map((img, j) => <img key={j} className="tool-image" src={dataUrlOf(img)} alt="screenshot" />)}
    </>
  );
}

// What another agent did for an agents.ask call, or a script tool's steps: as it goes, then as kept
// with the result. An agent's first message, the task, is the call's arguments above.
// A script's steps come as the panel's sub-agent events too, named after the tool.
const NO_SUB_RUNS = {};
// `keepOpen` (Settings → Display): left open once it ends, else it closes then.
function SubAgentRun({ callId, agentRun, trace, running, keepOpen }: { callId: string; agentRun: boolean; trace?: SubTrace; running: boolean; keepOpen: boolean }) {
  const live = useContext(SubRunsContext)[callId];
  const run = trace ? { agent: trace.agent, messages: trace.steps ? trace.messages : trace.messages.slice(1), live: [] } : live;
  if (!run) return null;
  const results = toolResultsById(run.messages);
  return (
    <details className="sub-agent" open={running || keepOpen || undefined}>
      <summary><Icon name={agentRun ? 'agent' : 'tool'} size={12} /> {run.agent}{running ? ' · working…' : ''}</summary>
      {/* Its own calls have no live runs of their own (those are the top-level calls'), and their ids
          are numbered apart: one may be this call's id, which would show this run inside itself, again
          and again. */}
      <SubRunsContext.Provider value={NO_SUB_RUNS}>
        {run.messages.map((m) => <MessageView key={keyOf(m)} message={m} results={results} running={running} />)}
      </SubRunsContext.Provider>
      {run.live.map((s, i) => (s.kind === 'reasoning' ? <Reasoning key={`l${i}`} text={s.text} active={i === run.live.length - 1} /> : <AssistantText key={`l${i}`} text={s.text} format="markdown" />))}
    </details>
  );
}
