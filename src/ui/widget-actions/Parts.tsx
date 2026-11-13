// The parts of an action's editor (ui/widget-actions/Editor): the values it reads from the page, the
// tool it runs with its parameters, the boxes of its answer, and its model with how much it reasons.
import { useState } from 'react';
import type { ToolInfo } from '../../core/protocol';
import { INPUT, type ActionOutput, type WidgetAction } from '../../widget/actions';
import type { AgentProfile } from '../../agents/profiles';
import { baseParams } from '../../tools/custom/runtime';
import type { Settings } from '../../storage/settings';
import { activeTarget, thinkingLevel } from '../../storage/settings-select';
import { resolveThinkingParam, thinkingLevels } from '../../providers/thinking';
import type { ThinkingLevel } from '../../core/types';
import { keyOf, patchAt } from '../keys';
import { withKey } from '../edits';
import { ParamHead, ProviderModel } from '../fields';
import { TemplateInput } from '../guide';
import { freeName, readsOf, repeatedName, type ReadRow } from './reads';
import { ToolOptions } from './Steps';

const THINKING_LABELS: Record<ThinkingLevel, string> = { off: 'Off', low: 'Low', medium: 'Medium', high: 'High' };

// How much the action's model reasons: as the chat has it for that model, or its own level; only the
// levels its provider sends (Settings → Providers), none when it sends no thinking setting.
function ThinkingChoice({ settings, action, owner, onChange }: { settings: Settings; action: WidgetAction; owner?: AgentProfile; onChange: (l: ThinkingLevel | undefined) => void }) {
  const { provider, model } = activeTarget(settings, action.model ? action : owner);
  if (!provider || !model) return null;
  const param = resolveThinkingParam(provider.thinkingParam, provider.baseURL);
  const levels = thinkingLevels(param);
  const label = (l: ThinkingLevel) => (param === 'enable_thinking' && l !== 'off' ? 'On' : THINKING_LABELS[l]);
  if (!levels.length) return <span className="muted small" title={`Settings → Providers: ${provider.name} sends no thinking setting`}>Thinking: the server's</span>;
  const chat = thinkingLevel(settings, provider.id, model);
  return (
    <label>Thinking
      <select value={action.thinking ?? ''} onChange={(e) => onChange((e.target.value || undefined) as ThinkingLevel | undefined)}>
        <option value="">As in the chat for {model} ({chat ? label(chat) : 'the server decides'})</option>
        {levels.map((l) => <option key={l} value={l}>{label(l)}</option>)}
      </select>
    </label>
  );
}

// Its model: its own provider and model, or its agent's (else the chat's), and its thinking.
export function ActionModel({ draft, owner, settings, patch }: { draft: WidgetAction; owner?: AgentProfile; settings: Settings; patch: (change: Partial<WidgetAction>) => void }) {
  return (
    <ProviderModel providers={settings.providers} providerId={draft.providerId} model={draft.model} none={owner?.model ? `${owner.name}'s model` : "The chat's model"} onChange={patch}>
      <ThinkingChoice settings={settings} action={draft} owner={owner} onChange={(thinking) => patch({ thinking })} />
    </ProviderModel>
  );
}

// Its model in a line.
export function modelLine(draft: WidgetAction, owner: AgentProfile | undefined, settings: Settings): string {
  const provider = settings.providers.find((p) => p.id === draft.providerId);
  const which = draft.model?.trim() ? `${provider?.name ?? draft.providerId} · ${draft.model}` : owner?.model ? `${owner.name}'s model` : "The chat's model";
  return draft.thinking ? `${which} · thinking ${THINKING_LABELS[draft.thinking].toLowerCase()}` : which;
}

// The values an action reads from the page, by name: its tool's parameters use them as {name}. Edited
// as rows of their own, so that two given the same name (or none yet) are not merged into one: the
// action gets them once every name is its own (`onTwice` says the name used twice, else none). The
// rows are made from `reads` once: only this editor changes them while it is open.
export function PageReads({ reads, onChange, onTwice }: { reads: Record<string, string>; onChange: (reads: Record<string, string>) => void; onTwice: (name: string | undefined) => void }) {
  const [rows, setRows] = useState<ReadRow[]>(() => Object.entries(reads).map(([name, value]) => ({ name, value })));
  const change = (next: ReadRow[]) => {
    setRows(next);
    const again = repeatedName(next);
    onTwice(again);
    if (!again) onChange(readsOf(next));
  };
  return (
    <>
      {rows.map((row, i) => (
        <div key={keyOf(row)} className="custom-param-head">
          <input aria-label={`Name of value ${i + 1}`} className="narrow-input mono" value={row.name} placeholder="owner" onChange={(e) => change(patchAt(rows, i, { name: e.target.value }))} />
          <input aria-label={`How value ${i + 1} is read`} className="mono" value={row.value} placeholder="{{meta:octolytics-dimension-user_login}}" onChange={(e) => change(patchAt(rows, i, { value: e.target.value }))} />
          <button className="icon-button warn" title="Remove" aria-label={`Remove value ${i + 1}`} onClick={() => change(rows.filter((_, j) => j !== i))}>✕</button>
        </div>
      ))}
      <div className="row insert-chips">
        <button className="custom-add" onClick={() => change([...rows, { name: freeName(rows), value: '' }])}>＋ Add a value</button>
        {!rows.length && (
          <>
            <span className="muted small">or:</span>
            <button type="button" className="insert-chip mono" onClick={() => change([{ name: 'article', value: '{{page}}' }])}>article = {'{{page}}'}</button>
            <button type="button" className="insert-chip mono" onClick={() => change([{ name: 'address', value: '{{url}}' }])}>address = {'{{url}}'}</button>
          </>
        )}
      </div>
      <p className="hint">
        Read when it runs: <code>{'{{page}}'}</code> (the page's main text as Markdown, up to the size in this section's Limits tab),{' '}
        <code>{'{{selector:css}}'}</code>, <code>{'{{selector:css?attr}}'}</code>, <code>{'{{meta:name}}'}</code>, <code>{'{{schema:@Type:path}}'}</code> or <code>{'{{url}}'}</code> (the page's
        address). All but <code>{'{{page}}'}</code> are cut to 1,000 characters. The tool's parameters and the prompt take them as <code>{'{owner}'}</code>. On page load, an action whose values
        are not on the page does not run.
      </p>
    </>
  );
}

// The tool it runs and its parameters, each a template with chips for what the action takes and reads.
export function ToolAndArgs({ draft, tools, chips, noneLabel, patch }: { draft: WidgetAction; tools: ToolInfo[]; chips: string[]; noneLabel: string; patch: (change: Partial<WidgetAction>) => void }) {
  const tool = tools.find((t) => t.name === draft.tool);
  const params = tool ? baseParams(tool) : {};
  const required = (tool?.inputSchema as { required?: string[] } | undefined)?.required ?? [];
  const setArg = (name: string, template: string) => patch({ args: withKey(draft.args, name, template || undefined) });
  return (
    <>
      <label>The tool it runs (one that changes things asks you in the card first, as Website access says)
        <select aria-label="The tool it runs" value={draft.tool} onChange={(e) => patch({ tool: e.target.value, args: {} })}>
          <option value="">{noneLabel}</option>
          <ToolOptions tools={tools} picked={draft.tool} />
        </select>
      </label>
      {tool && Object.keys(params).length > 0 && (
        <div className="custom-params">
          <div className="field-label">Its parameters</div>
          {Object.entries(params).map(([name, prop]) => (
            <div key={name} className="custom-param">
              <ParamHead name={name} type={prop.type}>
                {required.includes(name) && <span className="badge">required</span>}
              </ParamHead>
              <TemplateInput label={`Value of ${name}`} value={draft.args[name] ?? ''} chips={chips} placeholder={chips.includes(INPUT) ? `${INPUT}, or a fixed value` : 'a fixed value'}
                onChange={(v) => setArg(name, v)} />
              {prop.description && <span className="muted small">{prop.description}</span>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// The boxes of its answer: with a prompt, the model's whole answer (one box) or a key of its JSON per
// box; else a path into the tool's answer, each line written and linked by a template.
export function Boxes({ draft, prompted, json, patch }: { draft: WidgetAction; prompted: boolean; json: boolean; patch: (change: Partial<WidgetAction>) => void }) {
  const setOutput = (i: number, change: Partial<ActionOutput>) => patch({ outputs: patchAt(draft.outputs, i, change) });
  return (
    <>
      {draft.outputs.map((o, i) => (
        <div key={keyOf(o)} className="custom-param">
          <div className="custom-param-head">
            <input aria-label={`Label of box ${i + 1}`} className="narrow-input" value={o.label} placeholder="Articles" onChange={(e) => setOutput(i, { label: e.target.value })} />
            {(!prompted || json) && <input aria-label={`Path of box ${i + 1}`} className="mono" value={o.from ?? ''} placeholder={json ? "key in the model's answer: summary" : 'path: [].title (none: the whole answer)'}
              onChange={(e) => setOutput(i, { from: e.target.value || undefined })} />}
            <span className="spacer" />
            <button className="icon-button warn" title="Remove" aria-label={`Remove box ${i + 1}`} onClick={() => patch({ outputs: draft.outputs.filter((_, j) => j !== i) })}>✕</button>
          </div>
          {!prompted && <div className="custom-param-head">
            <input aria-label={`Text of box ${i + 1}`} className="mono" value={o.text ?? ''} placeholder="each line: {full_name} ★ {stargazers_count} (optional)" onChange={(e) => setOutput(i, { text: e.target.value || undefined })} />
            <input aria-label={`Link of box ${i + 1}`} className="mono" value={o.link ?? ''} placeholder="link: https://wiki.example.com/wiki/{title} (optional)" onChange={(e) => setOutput(i, { link: e.target.value || undefined })} />
          </div>}
        </div>
      ))}
      <button className="custom-add" onClick={() => patch({ outputs: [...draft.outputs, { label: '' }] })}>＋ Add a box</button>
      {!prompted && <p className="hint">
        The path picks part of the tool's answer, as in an HTTP tool: <code>items[].title</code>, <code>[].{'{title,url}'}</code>.
        Each element of a list is a line; its text and link take its keys in braces (<code>{'{title}'}</code>), or{' '}
        <code>{'{value}'}</code> when it is a plain value; a link that is just <code>{'{url}'}</code> takes it as it is.
      </p>}
      {prompted && <p className="hint">{json ? 'With several boxes the model answers in JSON, a key per box.' : "One box: the model's whole answer. With several, it answers in JSON, a key per box."}</p>}
    </>
  );
}
