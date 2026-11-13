// An action's editor, as a guide: first what it is for (its kind, or an example), then its parts in the
// order a person thinks of them — where it shows, what it takes, values from the page, what it runs,
// how its answer shows, a try on a tab — and last its name and icon. Each step folds to a line once
// done; its optional parts stay folded to a line until opened; only what its kind uses is there.
// Problems show beside their fields once the user has been through their step, and the side card
// counts what is left.
import { useEffect, useState, type ReactNode } from 'react';
import type { ToolInfo } from '../../core/protocol';
import { plural, stableJson } from '../../core/util';
import { ACTION_INPUTS, actionProblems, answersInJson, INPUT, type ActionInput, type WidgetAction } from '../../widget/actions';
import { agentLabel, agentOffers, type AgentProfile } from '../../agents/profiles';
import { CREATE_TOOLS } from '../../core/builder-ids';
import { actionIcon } from '../../widget/protocol';
import { actionStore } from '../../widget/store';
import type { Settings } from '../../storage/settings';
import { hasSteps, stepKind } from '../../widget/steps';
import { BackToList, EditorFooter, Switch } from '../Collection';
import { IconName, MissingAccess } from '../fields';
import { Segmented } from '../Segmented';
import { FieldProblems, Fold, GuideStep, InlineAsk, KindCards, problemsAt as makeProblemsAt, TemplateInput, useGuide, type Asking } from '../guide';
import { ActionSpeakFields } from './ActionSpeak';
import { StepsEditor, StepsShow } from './Steps';
import { TryAction } from './TryAction';
import { ActionModel, Boxes, modelLine, PageReads, ToolAndArgs } from './Parts';
import {
  ACTION_EXAMPLES, ACTION_KINDS, asToolStep, EVERY_STEP, fieldOf, fromExample, hasWork, kindOf, kindPatch, listed, lostBy, OPTIONAL_STEPS, STEPS_OF, stepOfField, suggestActionName,
  type ActionField, type ActionKind, type ActionStepId,
} from './kinds';

// What the page widget can run: the tools that read, and those that act on a site (asked in the card
// first); not those that ask the user something, nor the ones that save skills, agents…
const runnable = (catalog: ToolInfo[]) => catalog.filter((t) => t.effect !== 'interact' && !CREATE_TOOLS.includes(t.name)).sort((a, b) => a.name.localeCompare(b.name));

const TITLES: Record<ActionStepId, string> = {
  kind: 'What it does',
  where: 'Where it shows',
  takes: 'What it takes',
  reads: 'Values from the page (optional)',
  runs: 'What it runs',
  shows: 'How the answer shows',
  try: 'Try it',
  name: 'Name and icon',
};

const short = (text: string, n = 70) => (text.length > n ? `${text.slice(0, n)}…` : text);
const inputLabel = (i: ActionInput) => ACTION_INPUTS.find((x) => x.value === i)?.label ?? i;

export function ActionEditor({ action, actions, catalog, agents, settings, onClose }: { action: WidgetAction; actions: WidgetAction[]; catalog: ToolInfo[]; agents: AgentProfile[]; settings: Settings; onClose: () => void }) {
  const [draft, setDraft] = useState(action);
  const [where, setWhere] = useState(action.where.join('\n'));
  const isNew = !actions.some((a) => a.id === action.id);
  // A new action is nothing yet until its kind is chosen; one that exists is what it has.
  const [kind, setKind] = useState<ActionKind | undefined>(isNew && !hasWork(action) ? undefined : kindOf(action));
  const ids = STEPS_OF[kind ?? 'none'];
  const guide = useGuide(ids, isNew, EVERY_STEP, OPTIONAL_STEPS);
  // Another kind or an example starts the parts that keep rows of their own afresh.
  const [round, setRound] = useState(0);
  const [asking, setAsking] = useState<Asking>();
  const [tried, setTried] = useState<string>();
  const [readTwice, setReadTwice] = useState<string>();
  const [badSteps, setBadSteps] = useState<string>();
  const [tryUpTo, setTryUpTo] = useState<{ steps: number; run: number }>();

  const patch = (change: Partial<WidgetAction>) => setDraft((d) => ({ ...d, ...change }));
  const patterns = where.split('\n').map((p) => p.trim()).filter(Boolean);
  const current = { ...draft, where: patterns, name: draft.name.trim() };
  // An agent's action uses only its tools, on its sites.
  const owner = agents.find((a) => a.id === draft.agent);
  // On page load (its own kind, or steps), only tools that read: the widget refuses the others then.
  const loads = kind === 'load' || draft.when === 'load';
  const all = runnable(agentOffers(owner, catalog, agents));
  const tools = loads ? all.filter((t) => t.effect === 'read') : all;
  const prompted = !!draft.prompt?.trim();
  const json = answersInJson(draft);
  const takesInput = kind !== 'load' && draft.when !== 'load' && draft.input !== 'none';
  const chips = [...(takesInput ? [INPUT] : []), ...Object.keys(draft.reads ?? {}).map((n) => `{${n}}`)];

  // Each problem beside its field, in its step.
  const texts = [...actionProblems(current, actions), ...(readTwice ? [`Two values are named "${readTwice}": give each its own name.`] : []), ...(badSteps ? [badSteps] : [])];
  // Where a kind shows what a problem is about: the prompt for the model's, the steps for steps.
  const fieldIn = (f: ActionField): ActionField => (kind === 'model' && f === 'tool' ? 'prompt' : kind === 'steps' && (f === 'tool' || f === 'prompt' || f === 'args') ? 'steps' : f);
  const issues = texts.map((text) => ({ field: fieldIn(fieldOf(text)), text }));
  const toStep = stepOfField(ids);
  const problemsAt = makeProblemsAt(issues, guide.seen, toStep);
  const left = (id: ActionStepId) => issues.filter((i) => toStep(i.field) === id).length;
  const step = (id: ActionStepId) => ({ guide, id, n: ids.indexOf(id) + 1, title: TITLES[id], problems: left(id) });
  // Those its kind has no field for, at the first step (a box's label on an action that opens the chat).
  const atKind = guide.seen.has('kind') ? issues.filter((i) => toStep(i.field) === 'kind').map((i) => i.text) : [];

  // A question asked in the first step goes once the user is elsewhere: what it would replace may have changed.
  useEffect(() => {
    if (guide.open !== 'kind') setAsking(undefined);
  }, [guide.open]);
  // A try says how the action as it was went: changed since, it is not tried.
  const tryKey = stableJson(current);
  useEffect(() => setTried(undefined), [tryKey]);

  // What would replace what the action has, asked first, naming it; nothing lost, nothing asked.
  const guard = (lost: string[], question: (lost: string) => string, act: string, run: () => void) => (lost.length ? setAsking({ question: question(listed(lost)), action: act, run }) : run());
  const fresh = () => {
    setRound((r) => r + 1);
    setTried(undefined);
    setReadTwice(undefined);
    setBadSteps(undefined);
  };
  const chooseKind = (k: ActionKind) => {
    if (k === kind) return;
    const title = ACTION_KINDS.find((x) => x.id === k)!.title;
    // The steps that still apply stay done: where it shows, what it takes, its values and its name.
    const keep = kind ? STEPS_OF[k].filter((id) => ['kind', 'where', 'takes', 'reads', 'name'].includes(id) && (id === 'kind' || guide.seen.has(id))) : ['kind' as const];
    const run = () => {
      setDraft((d) => ({ ...d, ...kindPatch(k, d, !kind) }));
      setKind(k);
      fresh();
      guide.restart(keep);
      guide.goTo(STEPS_OF[k].find((id) => !keep.includes(id) && !OPTIONAL_STEPS.includes(id)) ?? 'where', []);
    };
    if (kind) guard(lostBy(draft, { ...draft, ...kindPatch(k, draft, false) }), (lost) => `Make it "${title}"? It clears ${lost}.`, 'Change it', run);
    else run();
  };
  const takeExample = (ex: (typeof ACTION_EXAMPLES)[number]) =>
    guard(lostBy(draft, fromExample(draft, ex.action)), (lost) => `Start from "${ex.title}"? It replaces ${lost}.`, 'Replace', () => {
      setDraft((d) => fromExample(d, ex.action));
      setKind(ex.kind);
      fresh();
      guide.goTo('where', ['kind']);
    });
  // A page load action with a tool, made a step: steps can show a badge.
  const makeSteps = () => {
    patch(asToolStep(draft));
    setKind('steps');
    setRound((r) => r + 1);
  };
  // Tried up to a step, under the steps: What it runs stays open.
  const tryUpToStep = (steps: number) => setTryUpTo((t) => ({ steps, run: (t?.run ?? 0) + 1 }));

  const speakFold = (
    <Fold title="Reading aloud" summary={draft.speak ? `${draft.speak.profileId ? 'Its own voice' : 'As its agent'}, ${draft.speak.when === 'shown' ? 'on its own' : 'on a click'}` : 'As its agent, when you click 🔊 on a box'}>
      <ActionSpeakFields speak={draft.speak} owner={owner} loads={draft.when === 'load'} settings={settings} onChange={(speak) => patch({ speak })} />
    </Fold>
  );
  const modelFold = (
    <>
      <Fold title="Model and thinking" summary={modelLine(draft, owner, settings)}>
        <ActionModel draft={draft} owner={owner} settings={settings} patch={patch} />
      </Fold>
      <FieldProblems problems={problemsAt('model')} />
    </>
  );

  return (
    <section className="editor action-editor">
      <BackToList route="actions" title="Actions" />
      <div className="custom-editor-head">
        <h3>{isNew ? 'New action' : action.name}</h3>
        <span className="section-head-switch" title="Shown in the page widget">
          On <Switch checked={draft.enabled} label="Shown in the page widget" onChange={(enabled) => patch({ enabled })} />
        </span>
      </div>
      {action.createdBy === 'model' && <p className="hint">Made by the model, after you approved it.</p>}
      <div className="custom-editor-layout">
        <ol className="numbered-steps">
          <GuideStep {...step('kind')} waiting={!kind} summary={ACTION_KINDS.find((k) => k.id === kind)?.title ?? 'Not chosen'}>
            <KindCards kinds={ACTION_KINDS} label="What it does" kind={kind} onChoose={chooseKind} />
            <InlineAsk asking={asking} onDone={() => setAsking(undefined)} />
            <FieldProblems problems={atKind} />
            {isNew && (
              <div className="row insert-chips">
                <span className="muted small">Or start from an example:</span>
                {ACTION_EXAMPLES.map((ex) => <button key={ex.title} type="button" className="insert-chip" onClick={() => takeExample(ex)}>{ex.title}</button>)}
              </div>
            )}
          </GuideStep>

          {kind && (
            <GuideStep {...step('where')} summary={`${patterns.length ? short(patterns.join(', ')) : 'Every site granted one by one'} · ${owner ? agentLabel(owner) : draft.agent ? 'an agent that is gone' : 'Browser'}`}
              about="The pages its button shows on, and whose tools it uses.">
              <label>Websites: URL patterns, one per line (none: every site granted one by one in Website access{owner ? `, among ${owner.name}'s sites` : ''})
                <textarea aria-label="Websites" className="mono" rows={3} value={where} placeholder={'https://wiki.example.com/*\nhttps://code.example.com/*/*'} onChange={(e) => setWhere(e.target.value)} />
              </label>
              <MissingAccess origins={patterns} say={(missing) => `No access yet to ${missing.join(', ')}: the widget does not show up there.`} />
              <FieldProblems problems={problemsAt('where')} />
              <label>Agent (the action uses only its tools, and shows only on its sites)
                <select value={draft.agent ?? ''} onChange={(e) => patch({ agent: e.target.value || undefined })}>
                  <option value="">Browser</option>
                  {agents.map((a) => <option key={a.id} value={a.id}>{agentLabel(a)}{a.enabled ? '' : ' (off)'}</option>)}
                  {draft.agent && !owner && <option value={draft.agent}>(an agent that is gone)</option>}
                </select>
              </label>
            </GuideStep>
          )}

          {kind && ids.includes('takes') && (
            <GuideStep {...step('takes')} summary={takesLine(draft, kind)}>
              {kind === 'steps' && (
                <div className="guide-choice">
                  <span className="field-label">When it runs</span>
                  <Segmented label="When it runs" className="compact" value={draft.when === 'load' ? 'load' : 'click'}
                    onChange={(v) => patch(v === 'load' ? { when: 'load', input: 'none', besideSelection: undefined } : { when: undefined })}
                    options={[{ value: 'click', label: 'On a click' }, { value: 'load', label: 'On page load' }]} />
                </div>
              )}
              {draft.when !== 'load' && (
                <div className="guide-choice">
                  {kind === 'steps' && <span className="field-label">What it takes</span>}
                  <Segmented label="What it takes" className="compact" value={draft.input}
                    onChange={(v) => patch({ input: v, ...(v === 'none' && { besideSelection: undefined }) })}
                    options={ACTION_INPUTS.map((i) => ({ value: i.value, label: i.label }))} />
                </div>
              )}
              <FieldProblems problems={problemsAt('takes')} />
              {draft.when !== 'load' && draft.input !== 'none' && (
                <div className="guide-check">
                  <label className="check">
                    <input type="checkbox" checked={!!draft.besideSelection} onChange={(e) => patch({ besideSelection: e.target.checked || undefined })} />
                    <span>Show beside selected text</span>
                  </label>
                  <p className="hint">A button for it next to the speaker when you select text on its sites.</p>
                </div>
              )}
              <FieldProblems problems={problemsAt('beside')} />
              {draft.when !== 'load' && draft.input === 'text' && (
                <label>Hint in the field
                  <input value={draft.placeholder ?? ''} placeholder="platypus" onChange={(e) => patch({ placeholder: e.target.value || undefined })} />
                </label>
              )}
            </GuideStep>
          )}

          {kind && (
            <GuideStep {...step('reads')} optional summary={Object.keys(draft.reads ?? {}).length ? <span className="mono">{Object.keys(draft.reads!).map((n) => `{${n}}`).join(' ')}</span> : 'None: open it to read the page, its address or a part of it'}
              about="Values read from the page when it runs, each with a name its tool and prompt use.">
              <PageReads key={round} reads={draft.reads ?? {}} onChange={(reads) => patch({ reads: Object.keys(reads).length ? reads : undefined })} onTwice={setReadTwice} />
              <FieldProblems problems={problemsAt('reads')} />
            </GuideStep>
          )}

          {kind && (
            <GuideStep {...step('runs')} summary={runsLine(draft, kind)} about={RUNS_ABOUT[kind]}>
              {kind === 'steps' && (
                <>
                  <StepsEditor key={round} steps={draft.steps} tools={tools} onChange={(steps) => patch({ steps })} onBad={setBadSteps} onTry={tryUpToStep} />
                  {!hasSteps(draft) && <p className="hint">No steps yet: add one with ＋ read, ＋ tool or ＋ model above.</p>}
                  <FieldProblems problems={problemsAt('steps')} />
                  {tryUpTo && <TryAction action={current} upTo={tryUpTo} legend="Try up to a step" />}
                  {modelFold}
                </>
              )}
              {(kind === 'tool' || kind === 'load') && (
                <>
                  <ToolAndArgs draft={draft} tools={tools} chips={chips} noneLabel="Choose a tool…" patch={patch} />
                  <FieldProblems problems={[...problemsAt('tool'), ...problemsAt('args')]} />
                </>
              )}
              {(kind === 'model' || kind === 'chat') && (
                <>
                  <div className="guide-choice">
                    <span className="field-label">{kind === 'chat' ? 'The message sent to the chat' : 'Prompt for the model'}</span>
                    <TemplateInput label={kind === 'chat' ? 'The message' : 'Prompt'} rows={3} value={draft.prompt ?? ''} chips={chips}
                      placeholder={kind === 'chat' ? 'Summarize this article' : `Translate to Spanish: ${INPUT}`} onChange={(prompt) => patch({ prompt: prompt || undefined })} />
                  </div>
                  <FieldProblems problems={[...problemsAt('prompt'), ...(kind === 'chat' ? problemsAt('tool') : [])]} />
                </>
              )}
              {kind === 'model' && (
                <>
                  <Fold title="A tool first" summary={draft.tool ? <code>{draft.tool}</code> : "None: only the model answers"} initiallyOpen={false}>
                    <p className="hint">Its answer goes to the model after the prompt.</p>
                    <ToolAndArgs draft={draft} tools={tools} chips={chips} noneLabel="No tool" patch={patch} />
                  </Fold>
                  <FieldProblems problems={problemsAt('args')} />
                  {modelFold}
                </>
              )}
            </GuideStep>
          )}

          {kind && ids.includes('shows') && (
            <GuideStep {...step('shows')} summary={showsLine(draft)}>
              {kind === 'steps' ? (
                <StepsShow key={round} action={draft} onChange={patch} />
              ) : (
                <>
                  <Boxes draft={draft} prompted={prompted} json={json} patch={patch} />
                  {kind === 'load' && (
                    <Fold title="A badge on the bubble" summary="None: a badge comes from steps">
                      <p className="hint">A badge (a count, ✓ or ✗) comes from the values of steps. Its tool becomes the step <code>result</code>, with the same boxes and a badge from it.</p>
                      <div className="row"><button type="button" onClick={makeSteps} disabled={!draft.tool}>Make it steps</button>{!draft.tool && <span className="muted small">Choose its tool first.</span>}</div>
                    </Fold>
                  )}
                </>
              )}
              <FieldProblems problems={problemsAt('boxes')} />
              {speakFold}
            </GuideStep>
          )}

          {kind && ids.includes('try') && (
            <GuideStep {...step('try')} summary={tried ?? 'Not tried yet'} about="Run it as it is now, unsaved: nothing is kept.">
              <TryAction action={current} onTried={setTried} />
            </GuideStep>
          )}

          {kind && (
            <GuideStep {...step('name')} summary={<>{draft.icon ?? actionIcon(draft)} {draft.name.trim() || '(no name)'}</>} about="Its button in the page: the icon, and the name shown when the pointer is on it.">
              <IconName icon={draft.icon} name={draft.name} nameLabel="Name" namePlaceholder="Search Wikipedia" iconFallback={actionIcon(draft)} onChange={patch} />
              <SuggestedName draft={draft} actions={actions} onName={(name) => patch({ name })} />
              <FieldProblems problems={problemsAt('name')} />
            </GuideStep>
          )}
        </ol>
        <aside className="custom-editor-side">
          <div className="custom-side-card">
            <h4>Checks</h4>
            {!kind ? (
              <p className="muted">Choose what it does to start.</p>
            ) : issues.length ? (
              <>
                <p>{issues.length === 1 ? '1 thing left' : `${issues.length} things left`} before it can be saved:</p>
                <ul className="guide-left">
                  {ids.filter((id) => left(id)).map((id) => (
                    <li key={id}>
                      <button type="button" className="link-button" onClick={() => guide.show(id)}>{TITLES[id]}</button> · {left(id)}
                      {guide.seen.has(id) && <ul className="problems">{issues.filter((i) => toStep(i.field) === id).map((i) => <li key={i.text}>{i.text}</li>)}</ul>}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="custom-checks-ok">✓ Ready to save</p>
            )}
            {ids.includes('try') && <p className="muted small">{tried ?? 'Not tried yet'}</p>}
          </div>
        </aside>
      </div>
      <div className="editor-sticky-footer">
        <EditorFooter problems={kind ? texts : ['Choose what it does to start.']} quiet isNew={isNew} onSave={async () => { await actionStore.save(current); onClose(); }} onDelete={() => actionStore.remove(action.id)} onClose={onClose} />
      </div>
    </section>
  );
}

const RUNS_ABOUT: Record<ActionKind, ReactNode> = {
  model: <>The prompt the model answers. <code>{INPUT}</code> is what the action takes; a value from the page goes in as its name.</>,
  tool: <>The tool and its parameters. <code>{INPUT}</code> is what the action takes; a fixed value is sent as it is.</>,
  chat: 'The message sent to the chat at once. The chat attaches the page, as for any message, and answers as the action\'s agent.',
  load: 'A tool that reads, run when the page loads, with values from the page; no model.',
  steps: 'Each step uses the values of those before it as {name.path}. ▶ Try up to here runs the first ones in Try it.',
};

// The name, with one suggested from what it runs.
function SuggestedName({ draft, actions, onName }: { draft: WidgetAction; actions: WidgetAction[]; onName: (name: string) => void }) {
  const suggested = suggestActionName(draft, actions.filter((a) => a.id !== draft.id).map((a) => a.name.trim()));
  if (!suggested || suggested === draft.name.trim()) return null;
  return (
    <div className="row insert-chips">
      <span className="muted small">Suggested:</span>
      <button type="button" className="insert-chip" onClick={() => onName(suggested)}>{suggested}</button>
    </div>
  );
}

const takesLine = (d: WidgetAction, kind: ActionKind) =>
  [kind === 'steps' ? (d.when === 'load' ? 'On page load' : 'On a click') : '', d.when === 'load' ? '' : inputLabel(d.input), d.besideSelection && d.when !== 'load' && d.input !== 'none' ? 'beside selected text' : '']
    .filter(Boolean).join(' · ');

function runsLine(d: WidgetAction, kind: ActionKind): ReactNode {
  if (kind === 'steps') return d.steps?.length ? <span className="mono">{d.steps.map((s) => `${stepKind(s)} ${s.name}`).join(' → ')}</span> : 'No steps yet';
  if (kind === 'tool' || kind === 'load') return d.tool ? <code>{d.tool}</code> : 'No tool yet';
  const prompt = d.prompt?.trim() ? <span className="mono">{short(d.prompt.trim())}</span> : kind === 'chat' ? 'No message yet' : 'No prompt yet';
  return d.tool ? <><code>{d.tool}</code>, then {prompt}</> : prompt;
}

const showsLine = (d: WidgetAction) =>
  [d.outputs.length ? `${plural(d.outputs.length, 'box', 'boxes')}: ${d.outputs.map((o) => o.label || '(no label)').join(', ')}` : '', d.badge ? `badge ${d.badge}` : '', d.chatButtons ? 'buttons to the chat' : '']
    .filter(Boolean).join(' · ') || 'Nothing yet';
